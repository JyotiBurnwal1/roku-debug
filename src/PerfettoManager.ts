import * as fs from "fs";
import * as pathModule from "path";
import * as fsExtra from "fs-extra";
import { WebSocket } from "ws";
import { util } from "./util";

export class PerfettoManager {
    private port: number = 8060;
    private selectedChannel: string = "dev";
    private ws: WebSocket | null = null;
    private writeStream: fs.WriteStream | null = null;
    private pingTimer: NodeJS.Timeout | null = null;
    private currentTraceFile: string | null = null;
    private isTracing: boolean = false;

    constructor() {
    }

    /**
     * Get the profiling configuration from the debug session
     */
    private getConfig(): { host?: string; enabled?: boolean; dir?: string; filename?: string } {
        const config = util?._debugSession?.getPerfettoConfig() || {};
        return config as any;
    }

    /**
     * Start Perfetto tracing
     */
    public async startTracing(): Promise<{ error?: string; tracePath?: string }> {
        if (this.isTracing) {
            return { error: 'Tracing is already active' };
        }

        try {
            const config = this.getConfig();
            const tracesDir = config.dir || pathModule.join(process.cwd(), "traces");

            // Ensure directory exists
            fsExtra.ensureDirSync(tracesDir);

            const timestamp = new Date().toDateString().replace(/[:.]/g, '-');
            const filename = (config.filename || 'trace_${timestamp}.perfetto-trace')
                .replace('${timestamp}', timestamp)
                .replace('${appTitle}', 'app'); // You can get appTitle from launch config if needed

            const fullPath = pathModule.join(tracesDir, filename);
            this.currentTraceFile = fullPath;

            // Start WebSocket connection to receive trace data
            await this.startWebSocketTracing(fullPath);

            this.isTracing = true;
            return { tracePath: fullPath };

        } catch (error) {
            this.cleanup();
            return {
                error: `Error starting Perfetto tracing: ${error instanceof Error ? error.message : String(error)}`,
            };
        }
    }

    /**
     * Stop Perfetto tracing
     */
    public async stopTracing(): Promise<{ error?: string; tracePath?: string }> {
        if (!this.isTracing) {
            return { error: 'No active tracing session to stop' };
        }

        try {
            const tracePath = this.currentTraceFile;

            // Close WebSocket and cleanup
            this.cleanup();

            this.isTracing = false;

            return { tracePath: tracePath || undefined };

        } catch (error) {
            return {
                error: `Error stopping Perfetto tracing: ${error instanceof Error ? error.message : String(error)}`,
            };
        }
    }

    /**
     * Enable tracing on the Roku device
     */
    public async enableTracing(): Promise<{ error?: string }> {
        try {
            const response = await this.ecpGetPost(`/perfetto/enable/${this.selectedChannel}`, "post", "");
            if (!response.ok) {
                return { error: `Failed to enable tracing: ${response.statusText}` };
            }
            return {};
        } catch (error) {
            return {
                error: `Error enabling Perfetto tracing: ${error instanceof Error ? error.message : String(error)}`,
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
            this.writeStream = fs.createWriteStream(filename, { flags: "w" });

            this.writeStream.on("error", (err) => {
                console.error("File write error:", err);
                reject(err);
            });

            this.ws.on("open", () => {
                console.log("Perfetto WebSocket connected:", url);

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

            this.ws.on("message", (data: any, isBinary: boolean) => {
                // Only process binary data
                if (!isBinary || !this.writeStream) return;

                // Write to file with backpressure handling
                if (!this.writeStream.write(data)) {
                    this.ws?.pause();
                    this.writeStream.once("drain", () => {
                        this.ws?.resume();
                    });
                }
            });

            this.ws.on("error", (err: any) => {
                console.error("Perfetto WebSocket error:", err);
                reject(err);
            });

            this.ws.on("close", (code: number, reason: Buffer) => {
                console.log(`Perfetto WebSocket closed. Code: ${code} Reason: ${reason.toString()}`);
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
                this.ws.close();
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
        method: "post" | "get" = "get",
        body: string
    ): Promise<Response> {
        const config = this.getConfig();
        const host = config.host;
        if (!host) {
            throw new Error('No host configured for Perfetto tracing');
        }
        const url = `http://${host}:${this.port}${route}`;

        if (method === "post") {
            return fetch(url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: body,
            });
        } else {
            return fetch(url, {
                method: "GET",
                headers: {
                    "Content-Type": "text/xml",
                },
            });
        }
    }
}
