import { PerfettoClient } from "./PerfettoClient";
import { Readable } from "stream";
import * as fs from "fs";

export class PerfettoControls {
    constructor(
        public host: string, // the ip entered by the user
    ) {
        this.host = host;
    }
    public standardResponse: { message: string; error: boolean } = {
        message: '',
        error: false
    };
    private port: number = 8060;
    private useWebSocket: boolean = true; // Flag to determine if WebSocket should be used
    private stopCB: (() => void) | null = null; // To store the stop callback
    private selectedChannel: string = 'dev';
    
    public async startTracing(fileUriPath: string) {
        let perfettoClient = new PerfettoClient(this.host);
        if (!this.useWebSocket) {
            await this.ecpGetPost(`/perfetto/stop/${this.selectedChannel}`, 'post', "");
            await this.ecpGetPost(`/perfetto/enable/${this.selectedChannel}`, 'post', "");
            const startResult = await this.ecpGetPost(`/perfetto/start/${this.selectedChannel}`, 'post', "");
            if (startResult.ok){
                this.standardResponse.message = "Tracing started successfully!";
                this.standardResponse.error = false; 
            }
        } else {
            if (this.stopCB) {
                    try {
                        this.stopCB();
                    } catch (error) {
                        this.standardResponse.message = "Error stopping previous WebSocket trace: " + error;
                        this.standardResponse.error = false;
                    }
                    this.stopCB = null;
                    return this.standardResponse;
                }
            try {
                await this.ecpGetPost(`/perfetto/start/dev`, "post", "");
                this.stopCB = await perfettoClient.wsSaveTrace("/perfetto-session", fileUriPath)
                this.standardResponse.message = "Tracing started successfully!";
                this.standardResponse.error = false;
            } catch (error) {
                this.standardResponse.message = `Error fetching channels: ${error}`;
                this.standardResponse.error = true;
            }
        }
        return this.standardResponse
    }

    public async stopTracing(fileUriPath) {
        if (!this.useWebSocket) {
            const response = await this.ecpGetPost(`/perfetto/stop/dev`, "post", "");
            if (!response.ok){
                this.standardResponse.message = `Failed to stop tracing: ${response.statusText}`;
                this.standardResponse.error = true;
                return this.standardResponse;
            }
            const contentDisposition = response.headers.get(
              "content-disposition"
            );
            let filename = "default_filename"; // Fallback filename

            if (!contentDisposition || !contentDisposition.includes("filename=")) {
                this.standardResponse.message = `No data to save try to 1. [Record] 2. [Launch] before [Save]`;
                this.standardResponse.error = true;
                return this.standardResponse;
            }

            if (response.body === null) {
                this.standardResponse.message = 'No data received for channel!';
                this.standardResponse.error = true;
                return this.standardResponse;
            }

            await this.writeReadableStreamToFile(response.body, fileUriPath);
        } else {
            const delayStop = await this.getDelayStop() || null;
            if (this.stopCB) {
              await new Promise((resolve) => setTimeout(resolve, delayStop)); // Wait for 3 seconds to ensure all data is received
              this.stopCB();
              this.stopCB = null;
            } else {
                this.standardResponse.message =  'No active recording found for channel! ' + this.selectedChannel;
                this.standardResponse.error = true;
              return this.standardResponse;
            }
        }
        // TODO: implement write tracing to a file 
        return this.standardResponse
    }

    private async getDelayStop(): Promise<number> {
        return 3000;
    }

    public async enableTracing() {
        try {
            await this.ecpGetPost(`/perfetto/enable/dev`, "post", "");
            this.standardResponse.message = "Tracing enabled successfully!";
            this.standardResponse.error = false;
        } catch (error) {
            this.standardResponse.message = `Error enabling tracing: ${error}`;
            this.standardResponse.error = true;
        }
        return this.standardResponse
    }

    private async ecpGetPost(route: string, method: 'post' | 'get' = 'get', body: string){
        const url = `http://${this.host}:${this.port}${route}`;
        if (method === 'post') {
            return fetch(url, {
                method: "POST",
                headers: {
                    "Content-Type": "text/xml",
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

    private async writeReadableStreamToFile(
        readableStream,
        filePath: string
    ): Promise<void> {
        const nodeReadableStream = Readable.from(readableStream);
        const fileStream = fs.createWriteStream(filePath);

        return new Promise((resolve, reject) => {
            nodeReadableStream.pipe(fileStream);
            fileStream.on("finish", () => resolve());
            fileStream.on("error", reject);
        });
    }
}