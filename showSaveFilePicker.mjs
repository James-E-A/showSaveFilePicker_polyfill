const SYMBOL_0 = "24210c56-6c8a-11f0-8000-fcd436b36def"; // establishment
const SYMBOL_1 = "24210c56-6c8a-11f0-8001-fcd436b36def"; // call to helper
const SYMBOL_2 = "24210c56-6c8a-11f0-8002-fcd436b36def"; // call to worker
const SYMBOL_3 = "24210c56-6c8a-11f0-8003-fcd436b36def"; // heartbeat

const ONE_SECOND = 1_000;
const FIVE_SECONDS = 5_000;
const TEN_SECONDS = 10_000;

const helperURL = (
	new URL(
		new URLSearchParams(new URL(import.meta.url).search).get("helperURL") ?? "./helper.html",
		import.meta.url
	)
).toString();
const helperOrigin = new URL(helperURL).origin;

const _showSaveFilePicker = freshWindow().showSaveFilePicker;


export async function showSaveFilePicker(options) {
	if (_showSaveFilePicker && !(options._usePolyfill))
		return _showSaveFilePicker(options);

	let helper = await _helper;
	let writable = await rpcCall(helper, SYMBOL_1, options, { targetOrigin: helperOrigin });
	return new FakeWritableFileSystemFileHandle(writable);
}


export default (_showSaveFilePicker || showSaveFilePicker);


var _helper = new Promise((resolve, reject) => {
	if (stripURL(window.location) === helperURL) {
		resolve(window);
		return;
	}

	let settled = new AbortController();
	resolve = ((c, f) => (value) => (c.abort(null), f(value)))(settled, resolve);
	reject = ((c, f) => (reason) => (c.abort(reason), f(reason)))(settled, reject);

	let helperFrame = document.createElement("iframe");
	helperFrame.src = helperURL;
	helperFrame.hidden = true;
	document.documentElement.appendChild(helperFrame);

	settled.signal.addEventListener('abort', ({ target: { reason: error } }) => {
		if (error === null) {
			console.info("showSaveFilePicker helper OK");
			return;
		}

		helperFrame.parentElement.removeChild(helperFrame);
	});

	rpcAddHandler(SYMBOL_0, ({ ready, error }, { source }) => {
		if (ready)
			resolve(source);
		else
			reject(error);
	}, { source: helperFrame.contentWindow })

	setTimeout(() => void reject(new DOMException("Timed out waiting for showSaveFilePicker helper to be ready.", "TimeoutError")), TEN_SECONDS);
});


/* methods */

class FakeWritableFileSystemFileHandle {
	_writable;
	constructor(writable) {
		this._writable = writable;
	}

	async createSyncAccessHandle() {
		throw new DOMException("createSyncAccessHandle not available.", "NotImplementedError");
	}

	async createWritable() {
		return this._writable;
	}

	async getFile() {
		throw new DOMException("getFile not available.", "NotImplementedError");
	}
}


function freshWindow() {
	let frame = document.createElement("iframe");
	document.documentElement.appendChild(frame);
	try {
		return frame.contentWindow;
	} finally {
		frame.parentElement.removeChild(frame);
	}
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
