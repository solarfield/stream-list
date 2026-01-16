/**
 * @abstract
 */
export class StreamListAdapter {
	/**
	 * Loads items data starting at the specified offset and resolves to a StreamListLoadResult.
	 * @param {*} context - Generic info which will be passed from StreamList#load().
	 * @param {int} offset - Item offset to start load from. Zero-based.
	 * @return {Promise<StreamListLoadResult, Error>} Loaded items.
	 */
	async loadItems(context, offset) {
		throw new Error("Method is abstract.");
	}

	/**
	 * Gets the item's unique key.
	 * This can be any value which uniquely identifies the item.
	 * @param {*} item - The item.
	 * @return {*} The key.
	 */
	getItemKey(item) {
		throw new Error("Method is abstract.");
	}

	/**
	 * Creates an HTML element for the item.
	 * @param {*} item - The item.
	 * @param {HTMLElement} container - The container element.
	 * @return {HTMLElement} The rendered item to be added to the container.
	 */
	renderItem(item, container) {
		throw new Error("Method is abstract.");
	}

	/**
	 * @param {object} [options]
	 */
	constructor(options) {

	}
}

/**
 * @typedef {object} StreamListLoadResult
 * @param {*[]} StreamListLoadResult.items - List of items.
 */