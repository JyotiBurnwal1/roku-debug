/* eslint-disable no-template-curly-in-string */
import * as fs from 'fs';
import * as pathModule from 'path';
import * as fsExtra from 'fs-extra';
import { WebSocket } from 'ws';
import { util } from './util';

/**
 * Configuration interface for Perfetto tracing
 */
interface PerfettoConfig {
    host?: string;
    enabled?: boolean;
    dir?: string;
    filename?: string;
    rootDir?: string;
}

export class PerfettoManager {
    private port = 8060;
    private selectedChannel = 'dev';
    private ws: WebSocket | null = null;
    private writeStream: fs.WriteStream | null = null;
    private pingTimer: NodeJS.Timeout | null = null;
    private currentTraceFile: string | null = null;
    private isTracing = false;
    private isEnabled = false;

    /**
     * Get the profiling configuration from the debug session
     */
    private getConfig(): PerfettoConfig {
        const config = util?._debugSession?.getPerfettoConfig() || {};
        return config as PerfettoConfig;
    }

    /**
     * Get app title from manifest file in cwd
     */
    private getAppTitle(cwd: string): string {
        if (cwd) {
            try {
                const manifestPath = pathModule.join(cwd, 'manifest');

                if (fs.existsSync(manifestPath)) {
                    const manifestContent = fs.readFileSync(manifestPath, 'utf-8');
                    const titleMatch = /^title=(.+)$/m.exec(manifestContent);
                    if (titleMatch && titleMatch[1]) {
                        return titleMatch[1].trim();
                    }
                }
            } catch (error) {
                console.error('Error reading manifest file:', error);
            }
        }
        return 'trace';
    }

    /**
     * Start Perfetto tracing
     */
    public async startTracing(): Promise<{ error?: string; message?: string }> {
        if (this.isTracing) {
            return { error: 'Tracing is already active' };
        }

        // Auto-enable if not already enabled
        if (!this.isEnabled) {
            const enableResult = await this.enableTracing();
            if (enableResult.error) {
                return enableResult;
            }
        }

        try {
            const config = this.getConfig();
            const cwd = config.rootDir;
            const tracesDir = config.dir || pathModule.join(cwd, 'traces');

            // Ensure directory exists
            fsExtra.ensureDirSync(tracesDir);

            let filename = this.getFilename(config, tracesDir);

            const fullPath = pathModule.join(tracesDir, filename);
            this.currentTraceFile = fullPath;

            // Start WebSocket connection to receive trace data
            await this.startWebSocketTracing(fullPath);

            this.isTracing = true;
            let successMessage = `Perfetto tracing started. Saving to ${fullPath}`;
            return { message: successMessage };
        } catch (error) {
            this.cleanup();
            return {
                error: `Error starting Perfetto tracing: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }

    private getFilename(config: PerfettoConfig, tracesDir: string): string {
        let filename = config.filename || '${appTitle}_${timestamp}.perfetto-trace';

        if (filename.includes('${timestamp}')) {
            const timestamp = new Date()
                .toLocaleString()
                .replace(/[/:, ]/g, '-')
                .replace(/-+/g, '-');
            filename = filename.replace('${timestamp}', timestamp);
            // Remove sequence if the user has put timestamp
            if (filename.includes('${sequence}')) {
                filename = filename.replace(/_?\$\{sequence\}_?/g, '');
            }
        }

        const appTitle = this.getAppTitle(config.rootDir || '');
        if (filename.includes('${appTitle}')) {
            filename = filename.replace('${appTitle}', appTitle);
        }

        if (filename.includes('${sequence}')) {
            const nextSequence = this.getNextSequenceNumber(filename, tracesDir);
            filename = filename.replace('${sequence}', String(nextSequence));
        }

        return filename;
    }

    /**
     * Get the next sequence number by scanning existing files in the directory
     */
    private getNextSequenceNumber(filenameTemplate: string, tracesDir: string): number {
        try {
            if (!fs.existsSync(tracesDir)) {
                return 1;
            }

            const parts = filenameTemplate.split('${sequence}');
            const prefix = parts[0] || '';
            const suffix = parts[1] || '';

            const files = fs.readdirSync(tracesDir);
            let maxSequence = 0;

            for (const file of files) {
                if (file.startsWith(prefix) && file.endsWith(suffix)) {
                    const middle = file.slice(prefix.length, file.length - suffix.length);
                    const seq = parseInt(middle, 10);
                    if (!isNaN(seq) && seq > maxSequence) {
                        maxSequence = seq;
                    }
                }
            }

            return maxSequence + 1;
        } catch (error) {
            console.error('Error getting sequence number:', error);
            return 1;
        }
    }

    /**
     * Stop Perfetto tracing
     */
    public stopTracing(): Promise<{ error?: string; message?: string }> {
        if (!this.isTracing) {
            return Promise.resolve({ error: 'No active tracing session to stop' });
        }

        try {
            const tracePath = this.currentTraceFile;

            // Close WebSocket and cleanup
            this.cleanup();

            this.isTracing = false;
            let successMessage = `Perfetto tracing stopped. Trace saved to ${tracePath}`;
            return Promise.resolve({ message: successMessage });
        } catch (error) {
            return Promise.resolve({
                error: `Error stopping Perfetto tracing: ${error instanceof Error ? error.message : String(error)}`
            });
        }
    }

    /**
     * Enable tracing on the Roku device
     */
    public async enableTracing(): Promise<{ error?: string; message?: string }> {
        try {
            const config = this.getConfig();
            console.log(
                `Enabling Perfetto tracing on channel ${this.selectedChannel} at host ${config.host}`
            );
            const response = await this.ecpGetPost(
                `/perfetto/enable/${this.selectedChannel}`,
                '',
                'post'
            );
            if (!response.ok) {
                const responseText = await response.text().catch(() => '');
                return {
                    error: `Failed to enable tracing: ${response.status} ${response.statusText}. ${responseText}`
                };
            }
            this.isEnabled = true;
            let successMessage = `Perfetto tracing enabled on channel ${this.selectedChannel}`;
            return { message: successMessage };
        } catch (error) {
            return {
                error: `Error enabling Perfetto tracing: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }

    /**
     * Start WebSocket connection to receive trace data
     */
    private startWebSocketTracing(filename: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const config = this.getConfig();
            const host = config.host;
            if (!host) {
                reject(new Error('No host configured for Perfetto tracing'));
                return;
            }
            const url = `ws://${host}:${this.port}/perfetto-session`;
            this.ws = new WebSocket(url);

            // Create write stream
            this.writeStream = fs.createWriteStream(filename, { flags: 'w' });

            this.writeStream.on('error', (err) => {
                console.error('File write error:', err);
                reject(err);
            });

            this.ws.on('open', () => {
                console.log('Perfetto WebSocket connected:', url);

                // Send ping every 30 seconds to keep connection alive
                this.pingTimer = setInterval(() => {
                    if (this.ws?.readyState === WebSocket.OPEN) {
                        try {
                            this.ws.ping();
                        } catch (e) {
                            console.error('Ping error:', e);
                        }
                    }
                }, 30000);

                resolve();
            });

            this.ws.on('message', (data: any, isBinary: boolean) => {
                // Only process binary data
                if (!isBinary || !this.writeStream) {
                    return;
                }

                // Write to file with backpressure handling
                if (!this.writeStream.write(data)) {
                    this.ws?.pause();
                    this.writeStream.once('drain', () => {
                        this.ws?.resume();
                    });
                }
            });

            this.ws.on('error', (err: any) => {
                console.error('Perfetto WebSocket error:', err);
                reject(err);
            });

            this.ws.on('close', (code: number, reason: Buffer) => {
                console.log(
                    `Perfetto WebSocket closed. Code: ${code} Reason: ${reason.toString()}`
                );
                this.cleanup();
            });
        });
    }

    /**
     * Clean up resources
     */
    private cleanup(): void {
        if (this.pingTimer) {
            clearInterval(this.pingTimer);
            this.pingTimer = null;
        }

        if (this.ws) {
            try {
                this.ws.terminate();
            } catch (e) {
                console.error('Error closing WebSocket:', e);
            }
            this.ws = null;
        }

        if (this.writeStream) {
            this.writeStream.end();
            this.writeStream = null;
        }
    }

    /**
     * Make HTTP request to Roku ECP
     */
    private async ecpGetPost(
        route: string,
        body: string,
        method: 'post' | 'get' = 'get'
    ): Promise<Response> {
        const config = this.getConfig();
        const host = config.host;
        if (!host) {
            throw new Error('No host configured for Perfetto tracing');
        }
        const url = `http://${host}:${this.port}${route}`;

        if (method === 'post') {
            return fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: body
            });
        } else {
            return fetch(url, {
                method: 'GET',
                headers: {
                    'Content-Type': 'text/xml'
                }
            });
        }
    }
}
