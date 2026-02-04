import * as sinon from 'sinon';
import { expect } from 'chai';
import * as fs from 'fs';
import * as fsExtra from 'fs-extra';
import * as pathModule from 'path';
import { PerfettoManager } from './PerfettoManager';
import { util } from './util';
import { EventEmitter } from 'events';

describe('PerfettoManager', () => {
    let perfettoManager: PerfettoManager;
    let sandbox: sinon.SinonSandbox;
    let mockDebugSession: any;
    let mockWebSocket: any;
    let mockWriteStream: any;

    beforeEach(() => {
        sandbox = sinon.createSandbox();
        perfettoManager = new PerfettoManager();

        mockDebugSession = {
            getPerfettoConfig: sandbox.stub().returns({
                host: '192.168.1.100',
                enabled: true,
                dir: '/tmp/traces',
                filename: 'test_${timestamp}.perfetto-trace', // eslint-disable-line no-template-curly-in-string
                rootDir: '/workspace/project'
            })
        };

        // Mock util._debugSession
        (util as any)._debugSession = mockDebugSession;

        // Create mock WebSocket
        mockWebSocket = new EventEmitter();
        mockWebSocket.readyState = 1; // WebSocket.OPEN
        mockWebSocket.close = sandbox.stub();
        mockWebSocket.ping = sandbox.stub();
        mockWebSocket.pause = sandbox.stub();
        mockWebSocket.resume = sandbox.stub();

        // Create mock WriteStream
        mockWriteStream = new EventEmitter();
        mockWriteStream.write = sandbox.stub().returns(true);
        mockWriteStream.end = sandbox.stub();

        // Mock fs-extra
        sandbox.stub(fsExtra, 'ensureDirSync');

        // Mock fs.createWriteStream
        sandbox.stub(fs, 'createWriteStream').returns(mockWriteStream as any);

        // Mock fetch for ECP requests
        (global as any).fetch = sandbox.stub();
    });

    afterEach(() => {
        sandbox.restore();
        delete (util as any)._debugSession;
        delete (global as any).fetch;
    });

    describe('startTracing', () => {
        it('returns error when tracing is already active', async () => {
            // Start tracing first
            (perfettoManager as any).isTracing = true;

            const result = await perfettoManager.startTracing();

            expect(result.error).to.equal('Tracing is already active');
        });

        it('auto-enables tracing if not already enabled', async () => {
            (global as any).fetch = sandbox.stub().resolves({
                ok: true,
                text: () => Promise.resolve('')
            });

            // Mock WebSocket constructor
            sandbox.stub(require('ws'), 'WebSocket').callsFake(() => { // eslint-disable-line @typescript-eslint/no-var-requires
                setTimeout(() => mockWebSocket.emit('open'), 10);
                return mockWebSocket;
            });

            const result = await perfettoManager.startTracing();

            expect((perfettoManager as any).isEnabled).to.be.true;
            expect(result.message).to.include('Perfetto tracing started');
        });

        it('returns error if enabling fails', async () => {
            (global as any).fetch = sandbox.stub().resolves({
                ok: false,
                status: 500,
                statusText: 'Internal Server Error',
                text: () => Promise.resolve('Server error')
            });

            const result = await perfettoManager.startTracing();

            expect(result.error).to.include('Failed to enable tracing');
        });

        it('creates trace directory if it does not exist', async () => {
            (global as any).fetch = sandbox.stub().resolves({
                ok: true,
                text: () => Promise.resolve('')
            });

            sandbox.stub(require('ws'), 'WebSocket').callsFake(() => { // eslint-disable-line @typescript-eslint/no-var-requires
                setTimeout(() => mockWebSocket.emit('open'), 10);
                return mockWebSocket;
            });

            await perfettoManager.startTracing();

            expect((fsExtra.ensureDirSync as sinon.SinonStub).calledWith('/tmp/traces')).to.be.true;
        });

        it('uses default traces directory when not configured', async () => {
            mockDebugSession.getPerfettoConfig.returns({
                host: '192.168.1.100',
                enabled: true,
                rootDir: '/workspace/project'
            });

            (global as any).fetch = sandbox.stub().resolves({
                ok: true,
                text: () => Promise.resolve('')
            });

            sandbox.stub(require('ws'), 'WebSocket').callsFake(() => { // eslint-disable-line @typescript-eslint/no-var-requires
                setTimeout(() => mockWebSocket.emit('open'), 10);
                return mockWebSocket;
            });

            await perfettoManager.startTracing();

            expect((fsExtra.ensureDirSync as sinon.SinonStub).calledWith(
                pathModule.join('/workspace/project', 'traces')
            )).to.be.true;
        });
    });

    describe('stopTracing', () => {
        it('returns error when no active tracing session', async () => {
            const result = await perfettoManager.stopTracing();

            expect(result.error).to.equal('No active tracing session to stop');
        });

        it('stops tracing and returns success message', async () => {
            // Set up active tracing state
            (perfettoManager as any).isTracing = true;
            (perfettoManager as any).currentTraceFile = '/tmp/traces/test.perfetto-trace';
            (perfettoManager as any).ws = mockWebSocket;
            (perfettoManager as any).writeStream = mockWriteStream;

            const result = await perfettoManager.stopTracing();

            expect(result.message).to.include('Perfetto tracing stopped');
            expect(result.message).to.include('/tmp/traces/test.perfetto-trace');
            expect((perfettoManager as any).isTracing).to.be.false;
        });

        it('cleans up resources on stop', async () => {
            (perfettoManager as any).isTracing = true;
            (perfettoManager as any).currentTraceFile = '/tmp/traces/test.perfetto-trace';
            (perfettoManager as any).ws = mockWebSocket;
            (perfettoManager as any).writeStream = mockWriteStream;
            (perfettoManager as any).pingTimer = setInterval(() => { }, 1000);

            await perfettoManager.stopTracing();

            expect(mockWebSocket.close.called).to.be.true;
            expect(mockWriteStream.end.called).to.be.true;
        });
    });

    describe('enableTracing', () => {
        it('enables tracing on Roku device via ECP', async () => {
            (global as any).fetch = sandbox.stub().resolves({
                ok: true,
                text: () => Promise.resolve('')
            });

            const result = await perfettoManager.enableTracing();

            expect(result.message).to.include('Perfetto tracing enabled');
            expect((perfettoManager as any).isEnabled).to.be.true;
            expect((global as any).fetch.calledWith(
                'http://192.168.1.100:8060/perfetto/enable/dev',
                sinon.match.object
            )).to.be.true;
        });

        it('returns error when ECP request fails', async () => {
            (global as any).fetch = sandbox.stub().resolves({
                ok: false,
                status: 404,
                statusText: 'Not Found',
                text: () => Promise.resolve('Endpoint not found')
            });

            const result = await perfettoManager.enableTracing();

            expect(result.error).to.include('Failed to enable tracing');
            expect(result.error).to.include('404');
        });

        it('returns error when no host configured', async () => {
            mockDebugSession.getPerfettoConfig.returns({
                enabled: true,
                dir: '/tmp/traces'
            });

            const result = await perfettoManager.enableTracing();

            expect(result.error).to.include('No host configured');
        });

        it('handles network errors gracefully', async () => {
            (global as any).fetch = sandbox.stub().rejects(new Error('Network error'));

            const result = await perfettoManager.enableTracing();

            expect(result.error).to.include('Error enabling Perfetto tracing');
            expect(result.error).to.include('Network error');
        });
    });

    describe('getFilename', () => {
        it('replaces ${timestamp} placeholder', () => { // eslint-disable-line no-template-curly-in-string
            const config = {
                filename: 'trace_${timestamp}.perfetto-trace', // eslint-disable-line no-template-curly-in-string
                rootDir: '/workspace/project'
            };

            const filename = (perfettoManager as any).getFilename(config);

            // eslint-disable-next-line no-template-curly-in-string
            expect(filename).to.not.include('${timestamp}');
            expect(filename).to.match(/trace_\d{1,2}-\d{1,2}-\d{4}-\d{1,2}-\d{1,2}-\d{1,2}-(AM|PM)\.perfetto-trace/);
        });

        it('replaces ${appTitle} placeholder with value from manifest', () => { // eslint-disable-line no-template-curly-in-string
            sandbox.stub(fs, 'existsSync').returns(true);
            sandbox.stub(fs, 'readFileSync').returns('title=MyApp\nversion=1.0.0');

            const config = {
                filename: '${appTitle}_trace.perfetto-trace', // eslint-disable-line no-template-curly-in-string
                rootDir: '/workspace/project'
            };

            const filename = (perfettoManager as any).getFilename(config);

            expect(filename).to.equal('MyApp_trace.perfetto-trace');
        });

        it('uses default "trace" when manifest not found', () => {
            sandbox.stub(fs, 'existsSync').returns(false);

            const config = {
                filename: '${appTitle}_trace.perfetto-trace', // eslint-disable-line no-template-curly-in-string
                rootDir: '/workspace/project'
            };

            const filename = (perfettoManager as any).getFilename(config);

            expect(filename).to.equal('trace_trace.perfetto-trace');
        });

        it('removes ${sequence} when ${timestamp} is present', () => { // eslint-disable-line no-template-curly-in-string
            const config = {
                filename: '${appTitle}_${timestamp}_${sequence}.perfetto-trace', // eslint-disable-line no-template-curly-in-string
                rootDir: '/workspace/project'
            };

            sandbox.stub(fs, 'existsSync').returns(false);

            const filename = (perfettoManager as any).getFilename(config);

            // eslint-disable-next-line no-template-curly-in-string
            expect(filename).to.not.include('${sequence}');
        });

        it('uses default filename when not configured', () => {
            sandbox.stub(fs, 'existsSync').returns(false);

            const config = {
                rootDir: '/workspace/project'
            };

            const filename = (perfettoManager as any).getFilename(config);

            expect(filename).to.include('.perfetto-trace');
            expect(filename).to.not.include('${'); // eslint-disable-line no-template-curly-in-string
        });
    });

    describe('getAppTitle', () => {
        it('extracts title from manifest file', () => {
            sandbox.stub(fs, 'existsSync').returns(true);
            sandbox.stub(fs, 'readFileSync').returns('title=MyRokuApp\nversion=1.0.0\nmajor_version=1');

            const title = (perfettoManager as any).getAppTitle('/workspace/project');

            expect(title).to.equal('MyRokuApp');
        });

        it('returns "trace" when manifest does not exist', () => {
            sandbox.stub(fs, 'existsSync').returns(false);

            const title = (perfettoManager as any).getAppTitle('/workspace/project');

            expect(title).to.equal('trace');
        });

        it('returns "trace" when title not found in manifest', () => {
            sandbox.stub(fs, 'existsSync').returns(true);
            sandbox.stub(fs, 'readFileSync').returns('version=1.0.0\nmajor_version=1');

            const title = (perfettoManager as any).getAppTitle('/workspace/project');

            expect(title).to.equal('trace');
        });

        it('returns "trace" when cwd is empty', () => {
            const title = (perfettoManager as any).getAppTitle('');

            expect(title).to.equal('trace');
        });

        it('handles errors gracefully', () => {
            sandbox.stub(fs, 'existsSync').returns(true);
            sandbox.stub(fs, 'readFileSync').throws(new Error('Permission denied'));

            const title = (perfettoManager as any).getAppTitle('/workspace/project');

            expect(title).to.equal('trace');
        });
    });

    describe('cleanup', () => {
        it('clears ping timer', () => {
            const clearIntervalSpy = sandbox.spy(global, 'clearInterval');
            const timer = setInterval(() => { }, 1000);
            (perfettoManager as any).pingTimer = timer;

            (perfettoManager as any).cleanup();

            expect(clearIntervalSpy.calledWith(timer)).to.be.true;
            expect((perfettoManager as any).pingTimer).to.be.null;
        });

        it('closes WebSocket connection', () => {
            (perfettoManager as any).ws = mockWebSocket;

            (perfettoManager as any).cleanup();

            expect(mockWebSocket.close.called).to.be.true;
            expect((perfettoManager as any).ws).to.be.null;
        });

        it('ends write stream', () => {
            (perfettoManager as any).writeStream = mockWriteStream;

            (perfettoManager as any).cleanup();

            expect(mockWriteStream.end.called).to.be.true;
            expect((perfettoManager as any).writeStream).to.be.null;
        });

        it('handles WebSocket close errors gracefully', () => {
            mockWebSocket.close = sandbox.stub().throws(new Error('Already closed'));
            (perfettoManager as any).ws = mockWebSocket;

            expect(() => (perfettoManager as any).cleanup()).to.not.throw();
        });
    });

    describe('ecpGetPost', () => {
        it('makes POST request with correct parameters', async () => {
            (global as any).fetch = sandbox.stub().resolves({
                ok: true,
                text: () => Promise.resolve('success')
            });

            await (perfettoManager as any).ecpGetPost('/perfetto/enable/dev', '', 'post');

            expect((global as any).fetch.calledWith(
                'http://192.168.1.100:8060/perfetto/enable/dev',
                sinon.match({
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                })
            )).to.be.true;
        });

        it('makes GET request with correct parameters', async () => {
            (global as any).fetch = sandbox.stub().resolves({
                ok: true,
                text: () => Promise.resolve('success')
            });

            await (perfettoManager as any).ecpGetPost('/query/device-info', '', 'get');

            expect((global as any).fetch.calledWith(
                'http://192.168.1.100:8060/query/device-info',
                sinon.match({
                    method: 'GET',
                    headers: { 'Content-Type': 'text/xml' }
                })
            )).to.be.true;
        });

        it('throws error when no host configured', async () => {
            mockDebugSession.getPerfettoConfig.returns({
                enabled: true
            });

            try {
                await (perfettoManager as any).ecpGetPost('/perfetto/enable/dev', '', 'post');
                expect.fail('Should have thrown an error');
            } catch (error) {
                expect((error as Error).message).to.include('No host configured');
            }
        });
    });
});
