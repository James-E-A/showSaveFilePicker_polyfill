const SYMBOL_0 = "24210c56-6c8a-11f0-8000-fcd436b36def"; // establishment
const SYMBOL_1 = "24210c56-6c8a-11f0-8001-fcd436b36def"; // call to helper
const SYMBOL_2 = "24210c56-6c8a-11f0-8002-fcd436b36def"; // call to worker
const SYMBOL_3 = "24210c56-6c8a-11f0-8003-fcd436b36def"; // heartbeat

const ONE_SECOND = 1_000;
const FIVE_SECONDS = 5_000;
const TEN_SECONDS = 10_000;

const STREAMS = new Map(); // can't use self.caches for this because that can't hold dynamic Response objects


onfetch = function onfetch(event) {
	let response = STREAMS.get(stripURL(event.request.url));
	if (response !== undefined) {
		event.respondWith(response);
		return;
	}
}


rpcAddHandler(SYMBOL_2, function handler_2({ requestorOrigin, untrustedOptions, readable }) {
	let suggestedName = untrustedOptions?.suggestedName;
	if (!(suggestedName === undefined || typeof suggestedName === "string"))
		throw new TypeError("suggestedName should be a string, or undefined");

	let url = new URL(
		(suggestedName === undefined)
		? `./sw.cgi/stream/${encodeURIComponent(requestorOrigin)}/${crypto.randomUUID()}`
		: `./sw.cgi/stream/${encodeURIComponent(requestorOrigin)}/${crypto.randomUUID()}?filename=${encodeURIComponent(suggestedName)}`,
		self.location
	).toString();

	let key = stripURL(url);
	let response = new Response(
		readable,
		{ headers: {
			"Content-Disposition": "attachment",
		} }
	);

	STREAMS.set(key, response);
	setTimeout(evict, TEN_SECONDS, STREAMS, key);

	return url;
});


rpcAddHandler(SYMBOL_3, function handler_3() {});


/* methods */

function evict(map, key) {
	if (map.delete(key))
		console.warn("eviction: %s", key);
}


function rpcAddHandler(method_, handler, options) {
	let onceController = new AbortController(),
	    once = options?.once ?? false,
	    source_ = options?.source,
	    transferResult = options?.transferResult ?? false;

	self.addEventListener("message", async ({ data, origin, source }) => {
		if (source_ !== undefined && source !== source_)
			return;
		if (!(data instanceof Object))
			return;

		let { method, params, replyPort } = data;

		if (method !== method_)
			return;

		if (once)
			onceController.abort(null);

		reply: {
			try {
				try {
					var result = await handler(params, { origin, source });
				} catch (error) {
					// error executing handler
					replyPort.postMessage({ error });
					break reply;
				}
				// happy path
				replyPort.postMessage({ result }, { transfer: transferResult ? [result] : [] });
			} catch (error) {
				// error serializing reply
				replyPort.postMessage({ error });
			}
		}
	}, { signal: onceController.signal });
}


async function rpcCall(target, method, params, options) {
	let targetOrigin = options?.targetOrigin,
	    timeout = options?.timeout,
	    transfer = options?.transfer ?? [];

	if (timeout === undefined)
		timeout = FIVE_SECONDS;

	return await new Promise((resolve, reject) => {
		let { port1, port2 } = new MessageChannel();

		target.postMessage(
			{ method, params, replyPort: port2 },
			{ targetOrigin, transfer: transfer.concat([port2]) }
		);

		port1.onmessage = ({ data }) => {
			if ("result" in data)
				resolve(data.result);
			else
				reject(data.error);
		};

		port1.onmessageerror = (event) => {
			reject(event.error || new Error(`${event.target.__proto__.constructor.name}: ${event.type} event`, { cause: event }));
		};

		if (timeout !== null)
			setTimeout(() => void reject(new DOMException("Timed out waiting for RPC call.", "TimeoutError")), timeout);
	});
}


function stripURL(s) {
	let u = new URL(s);
	u.hash = "";
	u.search = "";
	return u.toString();
}
