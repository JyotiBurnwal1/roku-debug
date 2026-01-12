import { expect } from "chai";
import * as proxyquire from "proxyquire";
import { EventEmitter } from "events";
import * as sinonActual from "sinon";
let sinon = sinonActual.createSandbox();

describe("PerfettoClient", () => {
  let fetchStub: sinon.SinonStub;
  let mkdirSyncStub: sinon.SinonStub;
  let createWriteStreamStub: sinon.SinonStub;
  let wsConstructorStub: sinon.SinonStub;

  let fakeWs: any;
  let fakeStream: any;
  let ECP: any;

  beforeEach(() => {
    // ---- fetch stub ----
    fetchStub = sinon.stub();

    // ---- fake write stream ----
    fakeStream = new EventEmitter();
    fakeStream.write = sinon.stub().returns(true);
    fakeStream.end = sinon.stub();

    mkdirSyncStub = sinon.stub();
    createWriteStreamStub = sinon.stub().returns(fakeStream);

    // ---- fake WebSocket ----
    fakeWs = new EventEmitter();
    fakeWs.readyState = 1; // OPEN
    fakeWs.ping = sinon.stub();
    fakeWs.close = sinon.stub();
    fakeWs.pause = sinon.stub();
    fakeWs.resume = sinon.stub();

    wsConstructorStub = sinon.stub().returns(fakeWs);

    // ---- load module with mocks ----
    ({ ECP } = proxyquire("../src/ECP", {
      ws: { WebSocket: wsConstructorStub },
      fs: {
        mkdirSync: mkdirSyncStub,
        createWriteStream: createWriteStreamStub,
      },
      path: {
        dirname: sinon.stub().returns("/tmp"),
      },
      global: {
        fetch: fetchStub,
      },
    }));
  });

  afterEach(() => {
    sinon.restore();
  });

  describe("constructor", () => {
    it("should initialize ip and baseUrl", () => {
      const ecp = new ECP("192.168.1.10");
      expect(ecp.ip).to.equal("192.168.1.10");
      expect(ecp.baseUrl).to.equal("http://192.168.1.10:8060");
    });
  });

  describe("wsSaveTrace", () => {
    it("should create websocket and file stream", async () => {
      const ecp = new ECP("10.0.0.1");

      const shutdown = await ecp.wsSaveTrace("/trace", "/tmp/file.perfetto-trace");

      expect(wsConstructorStub.calledOnce).to.be.true;
      expect(mkdirSyncStub.calledOnce).to.be.true;
      expect(createWriteStreamStub.calledOnce).to.be.true;
      expect(shutdown).to.be.a("function");
    });

    it("should write binary websocket messages to file", async () => {
      const ecp = new ECP("10.0.0.1");
      await ecp.wsSaveTrace("/trace", "/tmp/file.perfetto-trace");

      const buffer = Buffer.from([1, 2, 3]);
      fakeWs.emit("message", buffer, true);

      expect(fakeStream.write.calledWith(buffer)).to.be.true;
    });

    it("should ignore non-binary messages", async () => {
      const ecp = new ECP("10.0.0.1");
      await ecp.wsSaveTrace("/trace", "/tmp/file.perfetto-trace");

      fakeWs.emit("message", "text", false);
      expect(fakeStream.write.called).to.be.false;
    });

    it("shutdown should close websocket and file", async () => {
      const exitStub = sinon.stub(process, "exit");
      const ecp = new ECP("10.0.0.1");

      const shutdown = await ecp.wsSaveTrace("/trace", "/tmp/file.perfetto-trace");
      shutdown!();

      expect(fakeStream.end.called).to.be.true;
      exitStub.restore();
    });
  });
});
