import { StreamListAdapter } from './adapter.js';
import { StreamListLoadError } from './error.js';
import { EventTarget } from "@mikecaines/event-target/src/event-target.js";

export { StreamListAdapter } from "./adapter.js";
export { StreamListLoadError } from "./error.js";

const LOG_LEVEL_ERROR = 3;
const LOG_LEVEL_NOTICE = 5;

export class StreamList {
	/**
	 * @constructor
	 * @param {Object} aOptions
	 * @param {HTMLElement} aOptions.container
	 * @param {StreamListAdapter} aOptions.adapter
	 * @param {int} [aOptions.viewChunkSize=4] - Number of items appended to document during each render pass.
	 * @param {int} [aOptions.displayThreshold=200] - Number of pixels from end of list, that will trigger a render pass.
	 * @param {int} [aOptions.preloadThreshold] - Number of items from end of data, that will trigger a data load.
	 * @param {int} [aOptions.loadRetryCount=9] - Number of retries if data loading failed.
	 * @param {int} [aOptions.loadRetryDelay=3000] - Delay before retrying data load, in milliseconds.
	 * @param {Logger} [aOptions.logger=self.console]
	 * @param {int} [aOptions.logLevel=3] - @see https://tools.ietf.org/html/rfc5424#page-11
	 * @param {boolean} [aOptions.reuseResults=false] - Whether to reuse existing results in subsequent searches.
	 *  When true, the matching item from the previous search will be reused as is, skipping the
	 *  (re)rendering the new data, etc. If an individual result's content can change based upon
	 *  search input, or is very time sensitive, set this to false to avoid 'stale' results.
	 */
	constructor(aOptions) {
		if (!(aOptions.container instanceof HTMLElement)) throw new Error(
			"The container option must be of type HTMLElement.",
		);
		this.#container = aOptions.container;

		if (!(aOptions.adapter instanceof StreamListAdapter)) throw new Error(
			"The adapter option must be of type StreamListAdapter.",
		);
		this.#adapter = aOptions.adapter;

		this.displayThreshold = aOptions.displayThreshold != null ? aOptions.displayThreshold : 200;
		this.loadRetryCount = aOptions.loadRetryCount != null ? aOptions.loadRetryCount : 9;
		this.loadRetryDelay = aOptions.loadRetryDelay != null ? aOptions.loadRetryDelay : 3000;
		this.viewChunkSize = aOptions.viewChunkSize != null ? aOptions.viewChunkSize : 4;
		this.logger = aOptions.logger != null ? aOptions.logger : self.console;
		this.logLevel = aOptions.logLevel != null ? aOptions.logLevel : 3;
		this.reuseResults = aOptions.reuseResults != null ? true == aOptions.reuseResults : false;

		this.preloadThreshold = aOptions.preloadThreshold != null
			? aOptions.preloadThreshold : this.#viewChunkSize * 2;
	}

	get preloadThreshold() {
		return this.#preloadThreshold;
	}

	set preloadThreshold(v) {
		var vv = parseInt(v);

		if (!(!isNaN(vv) && v >= 0)) throw new Error(
			"Invalid preloadThreshold '" + v + "'.",
		);

		this.#preloadThreshold = vv;
	}

	get loadRetryCount() {
		return this.#loadRetryCount;
	}

	set loadRetryCount(v) {
		var vv = parseInt(v);

		if (!(!isNaN(vv) && v >= 0)) throw new Error(
			"Invalid loadRetryCount '" + v + "'.",
		);

		this.#loadRetryCount = vv;
	}

	get loadRetryDelay() {
		return this.#loadRetryDelay;
	}

	set loadRetryDelay(v) {
		var vv = parseInt(v);

		if (!(!isNaN(vv) && v >= 0)) throw new Error(
			"Invalid loadRetryDelay '" + v + "'.",
		);

		this.#loadRetryDelay = vv;
	}

	get displayThreshold() {
		return this.#displayThreshold;
	}

	set displayThreshold(v) {
		var vv = parseInt(v);

		if (!(!isNaN(vv) && v >= 0)) throw new Error(
			"Invalid displayThreshold '" + v + "'.",
		);

		this.#displayThreshold = vv;
	}

	get viewChunkSize() {
		return this.#viewChunkSize;
	}

	set viewChunkSize(v) {
		var vv = parseInt(v);

		if (!(!isNaN(vv) && v > 0)) throw new Error(
			"Invalid viewChunkSize '" + v + "'.",
		);

		this.#viewChunkSize = vv;
	}

	get logLevel() {
		return this.#logLevel;
	}

	set logLevel(v) {
		var vv = parseInt(v);

		if (!(!isNaN(vv) && v >= 0)) throw new Error(
			"Invalid logLevel '" + v + "'.",
		);

		this.#logLevel = vv;
	}

	get logger() {
		return this.#logger;
	}

	set logger(v) {
		if (!(v && ('info' in v) && ('error' in v) && ('warn' in v) && ('debug' in v))) throw new Error(
			"Logger object must implement methods error(), warn(), info(), debug().",
		);

		this.#logger = v;
	}

	/**
	 * Loads the list item data, replacing any previously loaded data.
	 * @param {*=} aContext - Generic info which can be used to provide context to the load process.
	 *  e.g. a URL query string, search filters, etc.
	 *  The type/content of this object is defined by the associated StreamListAdapter.
	 * @returns {Promise.<*, Error>} Promise which resolves to the first successfully loaded data chunk.
	 * @public
	 * @see StreamListAdapter#loadItems
	 */
	load(aContext) {
		return new Promise(function (resolve, reject) {
			this.abort();
			this.#hasMoreData = true;
			this.#syncingAll = false;
			this.#loadRetryIndex = 0;
			window.addEventListener('scroll', this.#handleUnthrottledReflow);
			window.addEventListener('resize', this.#handleUnthrottledReflow);
			this.#loadDataChunk(aContext, 0, resolve, reject, 0);
		}.bind(this));
	}

	/**
	 * Aborts any currently executing load process.
	 * @public
	 */
	abort() {
		clearTimeout(this.#loadDataChunkTimeout);

		if (this.#loadPromise) {
			if ('abort' in this.#loadPromise) {
				this.#loadPromise.abort();
			}

			this.#loadPromise = null;
		}

		if (this.#loadDataChunkOnFailure) {
			this.#loadDataChunkOnFailure(new StreamListLoadError(
				"StreamList load aborted.",
				0, null, null, true,
			));

			this.#loadDataChunkOnFailure = null;
		}
	}

	/**
	 * Renders all remaining items to the list.
	 * @public
	 */
	renderAll() {
		this.#syncingAll = true;
		this.#syncView();
	}

	addEventListener(aEventType, aListener, aOptions) {
		this.#eventTarget.addEventListener(aEventType, aListener, aOptions);
	}

	removeEventListener(aEventType, aListener, aOptions) {
		this.#eventTarget.removeEventListener(aEventType, aListener, aOptions);
	}

	/** @type {HTMLElement} */ #container;
	/** @type {StreamListAdapter} */ #adapter;
	/** @type {EventTarget} */ #eventTarget = new EventTarget(['render-chunk']);
	/** @type {*[]} */ #itemsList = [];
	/** @type {int} */ #itemsListIndex = 0;
	/** @type {Map<*,*>} */ #itemsMap = new Map();
	/** @type {*} */ #syncViewTimeout = null;
	/** @type {boolean} */ #syncingAll = false;
	/** @type {?Promise} */ #loadPromise = null;
	/** @type {*} */ #loadInfo = null;
	/** @type {int} */ #loadRetryDelay;
	/** @type {int} */ #loadRetryIndex = 0;
	/** @type {int} */ #loadRetryCount;
	/** @type {*} */ #loadDataChunkTimeout = 0;
	/** @type {?function} */ #loadDataChunkOnFailure = null;
	/** @type {boolean} */ #hasMoreData = false;
	/** @type {int} */ #viewChunkSize;
	/** @type {int} */ #preloadThreshold;
	/** @type {int} */ #displayThreshold;
	/** @type {*} */ #logger = null;
	/** @type {int} */ #logLevel;

	/**
	 * Loads a chunk of item results via the adapter, starting from aOffset.
	 * Calls #handleLoadDataChunkTimeout().
	 * @param {*} aContext - @see StreamList#load
	 * @param {int} aOffset - The starting offset.
	 * @param {function=} aOnSuccess
	 * @param {function=} aOnFailure
	 * @param {int} aDelay
	 * @private
	 */
	#loadDataChunk(aContext, aOffset, aOnSuccess, aOnFailure, aDelay) {
		clearTimeout(this.#loadDataChunkTimeout);

		this.#loadDataChunkTimeout = setTimeout(
			this.#handleLoadDataChunkTimeout, aDelay,
			aContext, aOffset, aOnSuccess, aOnFailure,
		);
	}

	/**
	 * Called by #loadDataChunk().
	 * @param aContext
	 * @param aOffset
	 * @param aOnSuccess
	 * @param aOnFailure
	 * @private
	 */
	#handleLoadDataChunkTimeout = (aContext, aOffset, aOnSuccess, aOnFailure) => {
		var loadPromise;

		//keep a reference to any failure handler, which will get called if all retries fail
		this.#loadDataChunkOnFailure = aOnFailure;

		//whether we are replacing all existing data or not
		var replace = aOffset == 0;

		if (this.#hasMoreData || replace) {
			//load items via the adapter, storing the promise for use as a 'currently executing' flag
			new Promise(function (resolve) {
				loadPromise = this.#adapter.loadItems(aContext, aOffset);
				this.#loadPromise = loadPromise;
				resolve(loadPromise);

				if (this.#logLevel >= LOG_LEVEL_NOTICE) {
					this.#logger.info("Loading data from offset " + aOffset + ".");
				}
			}.bind(this))
				.then(function (r) {
					//if the the promises don't match, it indicates that the load was aborted.
					//We just ignore the result here, as it will get handled by abort() itself
					if (this.#loadPromise === loadPromise) {
						if (!(r && ('items' in r))) throw new StreamListLoadError(
							"Invalid load result. Key 'items' must be of type Array.",
							0, null, r, false,
						);

						this.#hasMoreData = this.#bindDataChunk(r.items, replace);

						if (!this.#hasMoreData) {
							if (this.#logLevel >= LOG_LEVEL_NOTICE) {
								this.#logger.info("Reached end of data.");
							}
						}

						if (replace) {
							this.#loadInfo = aContext;
						}

						this.#loadPromise = null;
						this.#loadRetryIndex = 0;
						this.#loadDataChunkOnFailure = null;

						//sync the view to check if we should show any new items
						this.#syncView();

						if (aOnSuccess) {
							aOnSuccess(r);
						}
					}
				}.bind(this))
				.catch(function (e) {
					this.#loadPromise = null;
					this.#loadDataChunkOnFailure = null;
					var msg = "Loading data failed.";

					//if we should retry
					if (this.#loadRetryIndex < this.#loadRetryCount) {
						msg += " Retrying in " + this.#loadRetryDelay + "ms.";
						this.#loadRetryIndex++;

						//load the data chunk again after a delay
						this.#loadDataChunk(aContext, aOffset, aOnSuccess, aOnFailure, this.#loadRetryDelay);
					} else {
						msg += " Will not retry.";

						if (aOnFailure) {
							aOnFailure(e);
						}
					}

					if (this.#logLevel >= LOG_LEVEL_ERROR) {
						this.#logger.error(msg, {
							exception: e,
						});
					}
				}.bind(this));
		}
	};

	/**
	 * Adds the loaded items to the store.
	 * @param {Array} aResults
	 * @param {boolean} aReplace
	 * @returns {boolean} Whether any items were added to the store.
	 * @private
	 */
	#bindDataChunk(aResults, aReplace) {
		var replace = aReplace != null ? aReplace : true;

		//holds the keys of all items we encountered during this call
		var chunkItemsSet = new Set();

		//holds the items we accepted during this call (i.e. excludes duplicates)
		var chunkItemsList = [];
		var i, len, result, itemKey, item, added, discarded, msg;

		for (i = 0, len = aResults.length; i < len; i++) {
			result = aResults[i];
			itemKey = this.#adapter.getItemKey(result);

			//if the item is not already in the current chunk
			if (!chunkItemsSet.has(itemKey)) {
				// get any existing matching item in the overall list
				item = this.#itemsMap.get(itemKey);

				//if we already have the item in the overall list
				if (item) {
					//if we are replacing results
					if (replace) {
						if (this.reuseResults) {
							// add the existing item
							chunkItemsList.push(item);
						} else {
							// add the new item
							chunkItemsList.push({
								result: result,
								key: itemKey,
							});
						}
					}

					//else we are appending results, discard the item as a duplicate
				}

				//else we don't have the item in the overall list yet
				else {
					// add the new item
					chunkItemsList.push({
						result: result,
						key: itemKey,
					});
				}

				chunkItemsSet.add(itemKey);
			}

			//else the item exists in the current chunk, discard it as a duplicate
		}

		if (replace) {
			this.#itemsMap.clear();
			this.#itemsList.splice(0);
			this.#itemsListIndex = 0;
		}

		for (i = 0, len = chunkItemsList.length; i < len; i++) {
			item = chunkItemsList[i];

			this.#itemsList.push(item);
			this.#itemsMap.set(item.key, item);
		}

		if (this.#logLevel >= LOG_LEVEL_NOTICE) {
			added = chunkItemsList.length;
			discarded = chunkItemsSet.size - added;

			msg = "Added " + added + " items.";
			if (discarded > 0) msg += " Discarded " + discarded + " duplicates.";

			this.#logger.info(msg);
		}

		return chunkItemsList.length > 0;
	}

	/**
	 * Displays a number of items by appending them to the container.
	 * @returns {int} The number of items loaded but not yet displayed.
	 * @private
	 */
	#bindViewChunk() {
		var chunk = document.createDocumentFragment();
		var chunkActualSize = 0;
		var i, item;

		for (
			i = 0;
			i < this.#viewChunkSize && this.#itemsListIndex < this.#itemsList.length;
			i++, this.#itemsListIndex++
		) {
			item = this.#itemsList[this.#itemsListIndex];

			//if the item hasn't been rendered yet (i.e. created the <li> element)
			if (!item.element) {
				item.element = this.#adapter.renderItem(item.result, this.#container);
			}

			chunk.appendChild(item.element);
			chunkActualSize++;
		}

		if (chunkActualSize > 0) {
			this.#container.appendChild(chunk);

			if (this.#eventTarget.hasEventListenerOfType('render-chunk')) {
				this.#eventTarget.dispatchEvent(this, {
					type: 'render-chunk',
					target: this,
				});
			}
		}

		return this.#itemsList.length - this.#itemsListIndex;
	}

	/**
	 * Checks if there are more items that need to be displayed.
	 * This is called from scroll event handlers, etc.
	 * Calls #handleSyncViewTimeout().
	 * @private
	 */
	#syncView() {
		cancelAnimationFrame(this.#syncViewTimeout);
		this.#syncViewTimeout = requestAnimationFrame(this.#handleSyncViewTimeout);
	}

	/**
	 * Called by #syncView().
	 * @private
	 */
	#handleSyncViewTimeout = () => {
		var itemsLeftCount, doStep, distance, viewportScrollY;

		if (this.#itemsListIndex == 0) {
			while (this.#container.hasChildNodes()) {
				this.#container.removeChild(this.#container.lastChild);
			}
		}

		if (this.#syncingAll) {
			doStep = true;
		} else {
			viewportScrollY = window.scrollY;
			if (viewportScrollY == undefined) viewportScrollY = document.documentElement.scrollTop; //ie11

			distance =
				(viewportScrollY + window.innerHeight)
				- (domOffsetTop(this.#container) + this.#container.offsetHeight);

			doStep = distance >= (this.#displayThreshold * -1);
		}

		if (doStep) {
			itemsLeftCount = this.#bindViewChunk();

			if (itemsLeftCount > 0) {
				this.#syncView();
			} else {
				if (!this.#hasMoreData) {
					window.removeEventListener('scroll', this.#handleUnthrottledReflow);
					window.removeEventListener('resize', this.#handleUnthrottledReflow);
				}
			}

			if (this.#hasMoreData) {
				if (!this.#loadPromise) {
					if (itemsLeftCount < this.#preloadThreshold) {
						this.#loadDataChunk(this.#loadInfo, this.#itemsList.length, null, null, 0);
					}
				}
			}
		}
	};

	/**
	 * Event handler for scroll, resize, etc.
	 * Calls #handleReflow().
	 * @private
	 */
	#handleUnthrottledReflow = () => {
		cancelAnimationFrame(this.#handleUnthrottledReflowTimeout);
		this.#handleUnthrottledReflowTimeout = requestAnimationFrame(this.#handleReflow);
	};

	/**
	 * Called by #handleUnthrottledReflow().
	 * @private
	 */
	#handleReflow = () => {
		this.#syncView();
	};

	#handleUnthrottledReflowTimeout;
}

function domOffsetTop(aElement) {
	var offset = 0;
	var el = aElement;

	do {
		offset += el.offsetTop;
	}
	while ((el = el.offsetParent));

	return offset;
}