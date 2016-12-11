define(
	'solarfield/stream-list/src/Solarfield/StreamList/StreamListAdapter',
	[
		'solarfield/ok-kit-js/src/Solarfield/Ok/ObjectUtils',
	],
	function (ObjectUtils) {
		"use strict";
		
		/**
		 * @class StreamListAdapter
		 */
		let StreamListAdapter = ObjectUtils.extend(Object, {
			/**
			 * Loads items data starting at the specified offset and resolves to a StreamListLoadResult.
			 * @param {*} aContext - Generic info which will be passed from StreamList#load().
			 * @param {int} aOffset - Item offset to start load from.
			 * @returns {Promise.<StreamListLoadResult, Error>} Loaded items.
			 */
			loadItems: function (aContext, aOffset) {
				throw new Error("Method is abstract.");
			},
			
			/**
			 * Gets the item's unique key.
			 * This can be any value which uniquely identifies the item.
			 * @param {*} aItem - The item.
			 * @returns {*} The key.
			 */
			getItemKey: function (aItem) {
				throw new Error("Method is abstract.");
			},
			
			/**
			 * Creates an HTML element for the item.
			 * @param {*} aItem - The item.
			 * @param {HTMLElement} aContainer - The container element.
			 */
			renderItem: function (aItem, aContainer) {
				throw new Error("Method is abstract.");
			},
			
			/**
			 * @param {{}} aOptions
			 */
			constructor: function (aOptions) {
				
			},
		});
		
		/**
		 * @typedef {{}} StreamListLoadResult
		 * @param {*[]} StreamListLoadResult.items - List of items.
		 */
		
		return StreamListAdapter;
	}
);