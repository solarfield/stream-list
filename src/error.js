/**
 * Error class which has additional details about the stream list.
 * @class StreamListLoadError
 * @extends CustomError
 */
export class StreamListLoadError extends Error {
	/**
	 * @param {string} aMessage
	 * @param {int=0} aCode
	 * @param {Error=} aPrevious
	 * @param {StreamListLoadResult} aResult
	 * @param {boolean} aAborted
	 * @constructor
	 * @property {StreamListLoadErrorDetails} streamListDetails
	 */
	constructor(aMessage, aCode, aPrevious, aResult, aAborted) {
		super(aMessage);

		// Maintains proper stack trace for where our error was thrown (non-standard)
		if (Error.captureStackTrace) {
			Error.captureStackTrace(this, this.constructor);
		}

		this.name = this.constructor.name;

		this.streamListDetails = {
			result: aResult,
			aborted: aAborted,
		};
	}
}

/**
 * @typedef {{}} StreamListLoadErrorDetails - Additional info about the load error.
 * @property {StreamListLoadResult} result - Any data returned by StreamListAdapter#loadItems.
 * @property {boolean} aborted - Whether the load was aborted.
 */
