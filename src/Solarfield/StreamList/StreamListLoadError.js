define(
	[
		'solarfield/ok-kit-js/src/Solarfield/Ok/ObjectUtils',
		'solarfield/ok-kit-js/src/Solarfield/Ok/CustomError'
	],
	function (
		ObjectUtils, CustomError
	) {
		"use strict";
		
		/**
		 * Error class which has additional details about the stream list.
		 * @class StreamListLoadError
		 * @extends CustomError
		 */
		var StreamListLoadError = ObjectUtils.extend(CustomError, {
			/**
			 * @param {string} aMessage
			 * @param {int=0} aCode
			 * @param {Error=} aPrevious
			 * @param {StreamListLoadResult} aResult
			 * @param {boolean} aAborted
			 * @constructor
			 * @property {StreamListLoadErrorDetails} streamListDetails
			 */
			constructor: function StreamListLoadError(aMessage, aCode, aPrevious, aResult, aAborted) {
				StreamListLoadError.super.call(this, aMessage, aCode, aPrevious);
				
				this.streamListDetails = {
					result: aResult,
					aborted: aAborted
				};
			}
		});
		
		return StreamListLoadError;
	}
);

/**
 * @typedef {{}} StreamListLoadErrorDetails - Additional info about the load error.
 * @property {StreamListLoadResult} result - Any data returned by StreamListAdapter#loadItems.
 * @property {boolean} aborted - Whether the load was aborted.
 */
 