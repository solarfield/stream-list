export class StreamListAdapter {
	/**
	 * Loads items data starting at the specified offset and resolves to a StreamListLoadResult.
	 * @param {*} aContext - Generic info which will be passed from StreamList#load().
	 * @param {int} aOffset - Item offset to start load from.
	 * @returns {Promise.<StreamListLoadResult, Error>} Loaded items.
	 */
	loadItems(aContext, aOffset) {
		throw new Error("Method is abstract.");
	}

	/**
	 * Gets the item's unique key.
	 * This can be any value which uniquely identifies the item.
	 * @param {*} aItem - The item.
	 * @returns {*} The key.
	 */
	getItemKey(aItem) {
		throw new Error("Method is abstract.");
	}

	/**
	 * Creates an HTML element for the item.
	 * @param {*} aItem - The item.
	 * @param {HTMLElement} aContainer - The container element.
	 */
	renderItem(aItem, aContainer) {
		throw new Error("Method is abstract.");
	}

	/**
	 * @param {{}} aOptions
	 */
	constructor(aOptions) {

	}
}

/**
 * @typedef {{}} StreamListLoadResult
 * @param {*[]} StreamListLoadResult.items - List of items.
 */