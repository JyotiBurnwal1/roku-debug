import * as fs from "fs";
import * as path from "path";
import * as fsExtra from "fs-extra";
import { WebSocket } from "ws";
import { BrightScriptDebugSession } from "./debugSession/BrightScriptDebugSession";

export class PerfettoControls {
    private port: number = 8060;
    private selectedChannel: string = "dev";
    private ws: WebSocket | null = null;
    private configs: any;
    private brightScriptDebugSession = new BrightScriptDebugSession();

    constructor(public host: string) {
        this.host = host;
        this.setConfigurations();
    }

    private setConfigurations(): void {
        const config = this.brightScriptDebugSession.getSelectedConfig(["profiling"]);
        this.configs = config.perfetto || {};
    }

    public async startTracing(): Promise<void> {
        try {
            const tracesDir = path.join(process.cwd(), "perfetto");
            fsExtra.ensureDirSync(tracesDir);
            const timestamp = new Date().toLocaleTimeString();
            this.brightScriptDebugSession.showPopupMessage(
                `Perfetto tracing started at ${timestamp}.`,
                "info",
                true
            );
            await this.wsSaveTrace("/perfetto-session", "trace.perfetto-trace");
        } catch (error) {
            this.brightScriptDebugSession.showPopupMessage(
                `Error starting Perfetto tracing: ${error}`,
                "error",
                true
            );
        }
    }

    public async stopTracing(): Promise<void> {
        if (!this.ws) {
            this.brightScriptDebugSession.showPopupMessage(
                "WebSocket tracing was not started. Cannot stop tracing.",
                "error",
                true
            );
            return;
        }

        const timestamp = new Date().toLocaleTimeString();
        this.brightScriptDebugSession.showPopupMessage(
            `Perfetto tracing stopped at ${timestamp}.`,
            "info",
            true
        );
        this.ws = null;
    }

    public async enableTracing(): Promise<void> {
        try {
            await this.ecpGetPost(`/perfetto/enable/${this.selectedChannel}`, "post", "");
            this.brightScriptDebugSession.showPopupMessage(
                "Perfetto tracing enabled.",
                "info",
                true
            );
        } catch (error) {
            this.brightScriptDebugSession.showPopupMessage(
                `Error enabling Perfetto tracing: ${error}`,
                "error",
                true
            );
        }
    }

    private async ecpGetPost(
        route: string,
        method: "post" | "get" = "get",
        body: string
    ): Promise<Response> {
        const url = `http://${this.host}:${this.port}${route}`;
        
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

    private async wsSaveTrace(urlpath: string, filename: string): Promise<(() => void) | null> {
        const url = `ws://${this.host}:8060${urlpath}`;
        this.ws = new WebSocket(url);

        // Ensure directory exists
        fs.mkdirSync(path.dirname(filename), { recursive: true });


        // Create write stream in append mode
        const out = fs.createWriteStream(filename, { flags: "a" });

        out.on("error", (err) => {
            console.error("File write error:", err);
            process.exit(1);
        });

        // Ping configuration
        const PING_INTERVAL_MS = 30000;
        let pingTimer: NodeJS.Timeout | null = null;

        this.ws.on("open", () => {
            console.log("WebSocket connected:", url);

            pingTimer = setInterval(() => {
                if (this.ws?.readyState === WebSocket.OPEN) {
                    try {
                        this.ws.ping();
                    } catch (error) {
                        // Silent catch for ping errors
                    }
                }
            }, PING_INTERVAL_MS);
        });

        this.ws.on("message", (data: Buffer, isBinary: boolean) => {
            console.log("Message receiving, binary:", isBinary);

            // Only process binary data
            if (!isBinary) return;

            // Handle backpressure when writing to file
            if (!out.write(data)) {
                this.ws?.pause();
                out.once("drain", () => {
                    this.ws?.resume();
                });
            }
        });

        this.ws.on("error", (err: Error) => {
            console.error("WebSocket error:", err);
        });

        this.ws.on("close", (code: number, reason: string) => {
            if (pingTimer) {
                clearInterval(pingTimer);
                pingTimer = null;
            }

            console.log(`WebSocket closed. Code: ${code}, Reason: ${reason}`);
            out.end();
        });

        // Graceful shutdown handler
        const shutdown = (): string => {
            console.log("Shutting down...");

            if (pingTimer) {
                clearInterval(pingTimer);
                pingTimer = null;
            }

            try {
                this.ws?.close();
            } catch {
                console.log("WebSocket already closed.");
            }

            out.end();
            return filename;
        };

        return shutdown;
    }
}
