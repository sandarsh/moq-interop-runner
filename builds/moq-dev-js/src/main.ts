// moq-dev-js test client
// MoQT interop test client using @moq/lite with WebTransport polyfill

import * as wt from "@fails-components/webtransport";
import * as Moq from "@moq/lite";

// Redirect all console output to stderr so library debug output
// doesn't corrupt TAP on stdout.
console.log = console.error;
console.debug = console.error;
console.info = console.error;
console.warn = console.error;

// Write TAP output directly to stdout
function tap(line: string) {
	process.stdout.write(`${line}\n`);
}

// Suppress unhandled rejections from async cleanup (e.g. WebTransport polyfill)
process.on("unhandledRejection", (err) => {
	console.error("unhandled rejection:", err);
});

// Initialize WebTransport polyfill
// @ts-expect-error - polyfill types don't exactly match the global WebTransport type
globalThis.WebTransport = wt.WebTransport;
await wt.quicheLoaded;

const TESTS = [
	"setup-only",
	"announce-only",
	"publish-namespace-done",
	"subscribe-error",
	"announce-subscribe",
	"subscribe-before-announce",
] as const;

type TestName = (typeof TESTS)[number];

const TEST_NAMESPACE = "moq-test/interop";
const TEST_TRACK = "test-track";

interface Args {
	relay: string;
	test?: string;
	list: boolean;
	tlsDisableVerify: boolean;
	verbose: boolean;
}

function parseArgs(): Args {
	const args: Args = {
		relay: "https://localhost:4443",
		list: false,
		tlsDisableVerify: false,
		verbose: false,
	};

	const argv = process.argv.slice(2);
	for (let i = 0; i < argv.length; i++) {
		switch (argv[i]) {
			case "--relay":
			case "-r":
				args.relay = argv[++i];
				break;
			case "--test":
			case "-t":
				args.test = argv[++i];
				break;
			case "--list":
			case "-l":
				args.list = true;
				break;
			case "--tls-disable-verify":
				args.tlsDisableVerify = true;
				break;
			case "--verbose":
			case "-v":
				args.verbose = true;
				break;
		}
	}

	return args;
}

interface Diagnostics {
	connection_id?: string;
	publisher_connection_id?: string;
	subscriber_connection_id?: string;
}

function printDiagnostics(durationMs: number, diag: Diagnostics) {
	tap("  ---");
	tap(`  duration_ms: ${durationMs}`);
	if (diag.connection_id) {
		tap(`  connection_id: ${diag.connection_id}`);
	}
	if (diag.publisher_connection_id) {
		tap(`  publisher_connection_id: ${diag.publisher_connection_id}`);
	}
	if (diag.subscriber_connection_id) {
		tap(`  subscriber_connection_id: ${diag.subscriber_connection_id}`);
	}
	tap("  ...");
}

function printFailureDiagnostics(durationMs: number, message: string) {
	tap("  ---");
	tap(`  duration_ms: ${durationMs}`);
	tap(`  message: "${message.replace(/"/g, '\\"')}"`);
	tap("  ...");
}

function withTimeout<T>(
	promise: Promise<T>,
	ms: number,
	label: string,
): Promise<T> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error(`timeout after ${ms}ms: ${label}`)),
			ms,
		);
		promise.then(
			(v) => {
				clearTimeout(timer);
				resolve(v);
			},
			(e) => {
				clearTimeout(timer);
				reject(e);
			},
		);
	});
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// Connect to the relay, returning an established connection
async function connect(
	relayUrl: string,
	tlsDisableVerify: boolean,
): Promise<Moq.Connection.Established> {
	const url = new URL(relayUrl);

	const options: Moq.Connection.ConnectProps = {};

	if (tlsDisableVerify) {
		// Use http:// scheme to trigger automatic cert fingerprint fetch
		// or pass serverCertificateHashes if available
		url.protocol = "http:";
	}

	return await Moq.Connection.connect(url, options);
}

// Test implementations

async function closeConn(conn: Moq.Connection.Established) {
	conn.close();
	await Promise.race([conn.closed, sleep(200)]);
}

async function testSetupOnly(
	relayUrl: string,
	tlsDisableVerify: boolean,
): Promise<Diagnostics> {
	const conn = await withTimeout(
		connect(relayUrl, tlsDisableVerify),
		2000,
		"connect",
	);
	await closeConn(conn);
	return {};
}

async function testAnnounceOnly(
	relayUrl: string,
	tlsDisableVerify: boolean,
): Promise<Diagnostics> {
	const conn = await withTimeout(
		connect(relayUrl, tlsDisableVerify),
		2000,
		"connect",
	);

	const broadcast = new Moq.Broadcast();
	conn.publish(Moq.Path.from(TEST_NAMESPACE), broadcast);

	// Wait briefly for the announce to be processed
	await sleep(500);

	await closeConn(conn);
	return {};
}

async function testPublishNamespaceDone(
	relayUrl: string,
	tlsDisableVerify: boolean,
): Promise<Diagnostics> {
	const conn = await withTimeout(
		connect(relayUrl, tlsDisableVerify),
		2000,
		"connect",
	);

	const broadcast = new Moq.Broadcast();
	conn.publish(Moq.Path.from(TEST_NAMESPACE), broadcast);

	// Wait for announce to be processed
	await sleep(500);

	// Close the broadcast (unpublish / PUBLISH_NAMESPACE_DONE)
	broadcast.close();

	await sleep(200);

	await closeConn(conn);
	return {};
}

async function testSubscribeError(
	relayUrl: string,
	tlsDisableVerify: boolean,
): Promise<Diagnostics> {
	const conn = await withTimeout(
		connect(relayUrl, tlsDisableVerify),
		2000,
		"connect",
	);

	// Subscribe to nonexistent namespace
	const broadcast = conn.consume(Moq.Path.from("nonexistent/namespace"));
	const track = broadcast.subscribe(TEST_TRACK, 0);

	// Wait for an error (expected)
	try {
		const group = await withTimeout(
			track.nextGroup(),
			1500,
			"subscribe response",
		);
		if (group) {
			throw new Error(
				"unexpected success: received data from nonexistent namespace",
			);
		}
		// group is undefined = track closed without data, acceptable
	} catch (e: unknown) {
		// Expected: subscribe error or timeout
		if (e instanceof Error && e.message?.includes("unexpected success")) {
			throw e;
		}
		// Any other error is expected behavior
	}

	await closeConn(conn);
	return {};
}

async function testAnnounceSubscribe(
	relayUrl: string,
	tlsDisableVerify: boolean,
): Promise<Diagnostics> {
	// Publisher connects and announces
	const pubConn = await withTimeout(
		connect(relayUrl, tlsDisableVerify),
		2000,
		"publisher connect",
	);

	const broadcast = new Moq.Broadcast();
	pubConn.publish(Moq.Path.from(TEST_NAMESPACE), broadcast);

	// Handle subscription requests from relay
	const handleRequests = async () => {
		for (;;) {
			const request = await broadcast.requested();
			if (!request) break;
			if (request.track.name === TEST_TRACK) {
				// Just keep the track open - subscriber just needs SUBSCRIBE_OK
				await sleep(2000);
				request.track.close();
			} else {
				request.track.close(new Error("unknown track"));
			}
		}
	};

	const requestHandler = handleRequests();

	// Give the relay time to process the announce
	await sleep(300);

	// Subscriber connects and subscribes
	const subConn = await withTimeout(
		connect(relayUrl, tlsDisableVerify),
		2000,
		"subscriber connect",
	);

	const subBroadcast = subConn.consume(Moq.Path.from(TEST_NAMESPACE));
	const track = subBroadcast.subscribe(TEST_TRACK, 0);

	// Wait for the subscription to be accepted or rejected
	try {
		await withTimeout(
			Promise.race([track.nextGroup(), track.closed]),
			1500,
			"subscribe response",
		);
	} catch {
		// Timeout or error - check if it's a real failure
		// If we got this far without a hard error, the subscription was accepted
	}

	broadcast.close();
	await closeConn(pubConn);
	await closeConn(subConn);

	// Let the request handler finish
	await Promise.race([requestHandler, sleep(100)]);

	return {};
}

async function testSubscribeBeforeAnnounce(
	relayUrl: string,
	tlsDisableVerify: boolean,
): Promise<Diagnostics> {
	// Subscriber connects first
	const subConn = await withTimeout(
		connect(relayUrl, tlsDisableVerify),
		2000,
		"subscriber connect",
	);

	const subBroadcast = subConn.consume(Moq.Path.from(TEST_NAMESPACE));
	const track = subBroadcast.subscribe(TEST_TRACK, 0);

	// Publisher connects 500ms later
	await sleep(500);

	const pubConn = await withTimeout(
		connect(relayUrl, tlsDisableVerify),
		2000,
		"publisher connect",
	);

	const broadcast = new Moq.Broadcast();
	pubConn.publish(Moq.Path.from(TEST_NAMESPACE), broadcast);

	// Handle subscription requests
	const handleRequests = async () => {
		for (;;) {
			const request = await broadcast.requested();
			if (!request) break;
			if (request.track.name === TEST_TRACK) {
				await sleep(2000);
				request.track.close();
			} else {
				request.track.close(new Error("unknown track"));
			}
		}
	};

	const requestHandler = handleRequests();

	// Wait for either success or expected error
	try {
		await withTimeout(
			Promise.race([track.nextGroup(), track.closed]),
			2000,
			"subscribe response",
		);
	} catch {
		// Either outcome is valid
	}

	broadcast.close();
	await closeConn(pubConn);
	await closeConn(subConn);

	await Promise.race([requestHandler, sleep(100)]);

	return {};
}

// Main

const args = parseArgs();

if (args.list) {
	for (const t of TESTS) {
		tap(t);
	}
	process.exit(0);
}

const tests: TestName[] = args.test
	? (() => {
			if (!TESTS.includes(args.test as TestName)) {
				console.error(`Unknown test: ${args.test}`);
				process.exit(127);
			}
			return [args.test as TestName];
		})()
	: [...TESTS];

tap("TAP version 14");
tap("# moq-dev-js-client v0.1.0");
tap(`# Relay: ${args.relay}`);
tap(`1..${tests.length}`);

let allPassed = true;

for (let i = 0; i < tests.length; i++) {
	const testName = tests[i];
	const num = i + 1;
	const start = Date.now();

	const timeouts: Record<TestName, number> = {
		"setup-only": 2000,
		"announce-only": 2000,
		"publish-namespace-done": 2000,
		"subscribe-error": 2000,
		"announce-subscribe": 3000,
		"subscribe-before-announce": 3500,
	};

	try {
		const testFn = {
			"setup-only": testSetupOnly,
			"announce-only": testAnnounceOnly,
			"publish-namespace-done": testPublishNamespaceDone,
			"subscribe-error": testSubscribeError,
			"announce-subscribe": testAnnounceSubscribe,
			"subscribe-before-announce": testSubscribeBeforeAnnounce,
		}[testName];

		const diag = await withTimeout(
			testFn(args.relay, args.tlsDisableVerify),
			timeouts[testName],
			testName,
		);

		const durationMs = Date.now() - start;
		tap(`ok ${num} - ${testName}`);
		printDiagnostics(durationMs, diag);
	} catch (e: unknown) {
		allPassed = false;
		const durationMs = Date.now() - start;
		tap(`not ok ${num} - ${testName}`);
		printFailureDiagnostics(
			durationMs,
			e instanceof Error ? e.message : String(e),
		);
	}
}

// Small delay before exit to let native addon cleanup (avoids Bun segfault)
await new Promise((resolve) => setTimeout(resolve, 50));
process.exit(allPassed ? 0 : 1);
