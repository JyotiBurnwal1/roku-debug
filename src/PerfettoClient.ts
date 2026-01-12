import { WebSocket } from "ws";
import * as fs from "fs";
import * as pathModule from "path";
 
export class PerfettoClient {
  /**
   * PerfettoClient class for Roku devices
   * This class provides methods to interact with Roku devices using the ECP API.
   */
  
  private ip: string;

  constructor(ip: string) {
    this.ip = ip;
  }

  async wsSaveTrace(path: string, filename: string): Promise<(() => void) | null> {
    const url = `ws://${this.ip}:8060${path}`;
    const ws = new WebSocket(url);
    
    // Ensure directory exists
    fs.mkdirSync(pathModule.dirname(filename), { recursive: true });
    
    // Create write stream in append mode
    const out = fs.createWriteStream(filename, { flags: "a" });
    
    out.on("error", (err) => {
      console.error("File write error:", err);
      process.exit(1);
    });

    // Ping configuration
    const PING_INTERVAL_MS = 30000;
    let pingTimer: NodeJS.Timeout | null = null;

    ws.on("open", () => {
      console.log("WebSocket connected:", url);
      
      pingTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          try {
            ws.ping();
          } catch (error) {
            // Silent catch for ping errors
          }
        }
      }, PING_INTERVAL_MS);
    });

    ws.on("message", (data: Buffer, isBinary: boolean) => {
      console.log("Message receiving, binary:", isBinary);
      
      // Only process binary data
      if (!isBinary) return;

      // Handle backpressure when writing to file
      if (!out.write(data)) {
        ws.pause?.();
        out.once("drain", () => {
          ws.resume?.();
        });
      }
    });

    ws.on("error", (err: Error) => {
      console.error("WebSocket error:", err);
    });

    ws.on("close", (code: number, reason: string) => {
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
        ws.close();
      } catch (error) {
        // Silent catch for close errors
      }
      
      out.write(Buffer.from([0x00]));
      out.end(() => process.exit(0));
      
      return filename;
    };

    return shutdown;
  }
}
