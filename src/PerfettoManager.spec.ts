// import { expect } from "chai";
// import { PerfettoControls } from "./PerfettoManager";
// import * as sinonActual from "sinon";
// let sinon = sinonActual.createSandbox();

// describe("PerfettoControls", () => {
//   let fetchStub: sinon.SinonStub;
//   let perfetto: PerfettoControls;

//   beforeEach(() => {
//     fetchStub = sinon.stub(global as any, "fetch");
//     perfetto = new PerfettoControls("192.168.1.5");
//   });

//   afterEach(() => {
//     sinon.restore();
//   });

//   describe("constructor", () => {
//     it("should initialize host and default standardResponse", () => {
//       expect(perfetto.host).to.equal("192.168.1.5");
//       expect(perfetto.standardResponse).to.deep.equal({
//         message: "",
//         error: false,
//       });
//     });
//   });

//   describe("startTracing", () => {
//     it("should call enable and start endpoints and return success response", async () => {
//       fetchStub.resolves({ ok: true } as any);

//       const response = await perfetto.startTracing();

//       expect(fetchStub.calledTwice).to.be.true;

//       expect(fetchStub.firstCall.args[0]).to.equal(
//         "http://192.168.1.5:8060/perfetto/enable/dev"
//       );
//       expect(fetchStub.secondCall.args[0]).to.equal(
//         "http://192.168.1.5:8060/perfetto/start/dev"
//       );

//       expect(response).to.deep.equal({
//         message: "Traceing started successfully",
//         error: false,
//       });
//     });

//     it("should set error response when enable/start fails", async () => {
//       fetchStub.rejects(new Error("Network error"));

//       const response = await perfetto.startTracing("");

//       expect(fetchStub.calledOnce).to.be.true;
//       expect(response.error).to.be.true;
//       expect(response.message).to.contain("Error fetching channels");
//     });
//   });

//   describe("stopTracing", () => {
//     it("should stop tracing and return success response when request succeeds", async () => {
//       fetchStub.resolves({ ok: true } as any);

//       const response = await perfetto.stopTracing("");

//       expect(fetchStub.calledOnce).to.be.true;
//       expect(fetchStub.firstCall.args[0]).to.equal(
//         "http://192.168.1.5:8060/perfetto/stop/dev"
//       );

//       expect(response).to.deep.equal({
//         message: "Traceing stopped successfully",
//         error: false,
//       });
//     });

//     it("should return error response when stop request fails", async () => {
//       fetchStub.resolves(null as any);

//       const response = await perfetto.stopTracing("");

//       expect(response).to.deep.equal({
//         message: "Error stopping tracing",
//         error: true,
//       });
//     });
//   });

//   describe("ecpGetPost (indirect)", () => {
//     it("should send POST request with correct headers and body", async () => {
//       fetchStub.resolves({ ok: true } as any);

//       await perfetto["ecpGetPost"]("/test", "post", "<xml />");

//       const [, options] = fetchStub.firstCall.args;

//       expect(options.method).to.equal("POST");
//       expect(options.body).to.equal("<xml />");
//       expect(options.headers["Content-Type"]).to.equal("text/xml");
//     });

//     it("should send GET request when method is get", async () => {
//       fetchStub.resolves({ ok: true } as any);

//       await perfetto["ecpGetPost"]("/test", "get", "");

//       const [, options] = fetchStub.firstCall.args;

//       expect(options.method).to.equal("GET");
//       expect(options.body).to.be.undefined;
//     });
//   });
// });
