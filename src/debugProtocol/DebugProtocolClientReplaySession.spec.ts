import { expect } from 'chai';
import { DebugProtocolClientReplaySession } from './DebugProtocolClientReplaySession';
import type { ProtocolRequest, ProtocolResponse, ProtocolUpdate } from './events/ProtocolEvent';
import * as fsExtra from 'fs-extra';

describe(DebugProtocolClientReplaySession.name, () => {
    let session: DebugProtocolClientReplaySession;

    afterEach(async () => {
        await session.destroy();
    });

    it('handles empty buffer log', async function test() {
        session = new DebugProtocolClientReplaySession({
            bufferLog: ''
        });

        await session.run();
        expectClientReplayResult([], session.result);
    });
});

// eslint-disable-next-line @typescript-eslint/ban-types
function expectClientReplayResult(expected: Array<string | Function | ProtocolRequest | ProtocolResponse | ProtocolUpdate>, result: DebugProtocolClientReplaySession['result']) {
    expected = expected.map(x => {
        if (typeof x === 'function') {
            return x?.name;
        }
        return x;
    });
    let sanitizedResult = result.map((x, i) => {
        //if there is no expected object for this entry, or it's a constructor, then we will compare the constructor name
        if (expected[i] === undefined || typeof expected[i] === 'string') {
            return x?.constructor?.name;
            //deep compare the actual object
        } else {
            return x;
        }
    });
    expect(sanitizedResult).to.eql(expected);
}
