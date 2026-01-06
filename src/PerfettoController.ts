export class PerfettoControls {
    constructor(
        public host: string, // the ip entered by the user
        public standardResponse: { message: string; error: boolean } = {
            message: '',
            error: false
        },
        private port: number = 8060,
    ) {
        this.host = host;
    }

    public async startTracing() {
        try {
            await this.ecpGetPost(`/perfetto/start/dev`, "post", "");
            this.standardResponse.message = "Tracing started successfully!";
            this.standardResponse.error = false;
        } catch (error) {
            this.standardResponse.message = `Error fetching channels: ${error}`;
            this.standardResponse.error = true;
        }
        return this.standardResponse
    }

    public async stopTracing() {
        const response = await this.ecpGetPost(`/perfetto/stop/dev`, "post", "");
        if (response){
            this.standardResponse.message = "Tracing stopped successfully!";
            this.standardResponse.error = false;
        } else{
            this.standardResponse.message = `Error stopping tracing`;
            this.standardResponse.error = true;
        }
        // TODO: implement write tracing to a file 
        return this.standardResponse
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
}