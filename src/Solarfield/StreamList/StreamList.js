define(
	[
		'solarfield/ok-kit-js/src/Solarfield/Ok/ObjectUtils',
		'solarfield/ok-kit-js/src/Solarfield/Ok/DomUtils',
		'solarfield/stream-list/src/Solarfield/StreamList/StreamListLoadError',
		'solarfield/stream-list/src/Solarfield/StreamList/StreamListAdapter',
		'solarfield/ok-kit-js/src/Solarfield/Ok/EventTarget',
	],
	function (ObjectUtils, DomUtils, StreamListLoadError, StreamListAdapter, EventTarget) {
		"use strict";

		var LOG_LEVEL_ERROR = 3;
		var LOG_LEVEL_NOTICE = 5;

		/**
		 * @class StreamList
		 */
		var StreamList = ObjectUtils.extend(Object, {
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
			 * @param {bool} [aOptions.reuseResults=false] - Whether to reuse existing results in subsequent searches.
			 *  When true, the matching item from the previous search will be reused as is, skipping the
			 *  (re)rendering the new data, etc. If an individual result's content can change based upon
			 *  search input, or is very time sensitive, set this to false to avoid 'stale' results.
			 */
			constructor: function (aOptions) {
				this._ssl_handleLoadDataChunkTimeout = this._ssl_handleLoadDataChunkTimeout.bind(this);
				this._ssl_handleSyncViewTimeout = this._ssl_handleSyncViewTimeout.bind(this);
				this._ssl_handleReflow = this._ssl_handleReflow.bind(this);
				this._ssl_handleUnthrottledReflow = this._ssl_handleUnthrottledReflow.bind(this);

				if (!(aOptions.container instanceof HTMLElement)) throw new Error(
					"The container option must be of type HTMLElement."
				);
				this._ssl_container = aOptions.container;

				if (!(aOptions.adapter instanceof StreamListAdapter)) throw new Error(
					"The adapter option must be of type StreamListAdapter."
				);
				this._ssl_adapter = aOptions.adapter;

				this._ssl_eventTarget = new EventTarget();
				this._ssl_itemsList = [];
				this._ssl_itemsListIndex = 0;
				this._ssl_itemsMap = new Map();
				this._ssl_syncViewTimeout = null;
				this._ssl_syncingAll = false;
				this._ssl_loadPromise = null;
				this._ssl_loadInfo = null;
				this._ssl_loadRetryDelay = null;
				this._ssl_loadRetryIndex = 0;
				this._ssl_loadRetryCount = null;
				this._ssl_loadDataChunkTimeout = 0;
				this._ssl_loadDataChunkOnFailure = null;
				this._ssl_hasMoreData = false;
				this._ssl_viewChunkSize = null;
				this._ssl_preloadThreshold = null;
				this._ssl_displayThreshold = null;
				this._ssl_logger = null;
				this._ssl_logLevel = null;

				this.displayThreshold = aOptions.displayThreshold != null ? aOptions.displayThreshold : 200;
				this.loadRetryCount = aOptions.loadRetryCount != null ? aOptions.loadRetryCount : 9;
				this.loadRetryDelay = aOptions.loadRetryDelay != null ? aOptions.loadRetryDelay : 3000;
				this.viewChunkSize = aOptions.viewChunkSize != null ? aOptions.viewChunkSize : 4;
				this.logger = aOptions.logger != null ? aOptions.logger : self.console;
				this.logLevel = aOptions.logLevel != null ? aOptions.logLevel : 3;
				this.reuseResults = aOptions.reuseResults != null ? true == aOptions.reuseResults : false;

				this.preloadThreshold = aOptions.preloadThreshold != null
					? aOptions.preloadThreshold : this._ssl_viewChunkSize * 2;
			},

			/**
			 * Loads the list item data, replacing any previously loaded data.
			 * @param {*=} aContext - Generic info which can be used to provide context to the load process.
			 *  e.g. a URL query string, search filters, etc.
			 *  The type/content of this object is defined by the associated StreamListAdapter.
			 * @returns {Promise.<*, Error>} Promise which resolves to the first successfully loaded data chunk.
			 * @public
			 * @see StreamListAdapter#loadItems
			 */
			load: function (aContext) {
				return new Promise(function (resolve, reject) {
					this.abort();
					this._ssl_hasMoreData = true;
					this._ssl_syncingAll = false;
					this._ssl_loadRetryIndex = 0;
					window.addEventListener('scroll', this._ssl_handleUnthrottledReflow);
					window.addEventListener('resize', this._ssl_handleUnthrottledReflow);
					this._ssl_loadDataChunk(aContext, 0, resolve, reject, 0);
				}.bind(this));
			},

			/**
			 * Aborts any currently executing load process.
			 * @public
			 */
			abort: function () {
				clearTimeout(this._ssl_loadDataChunkTimeout);

				if (this._ssl_loadPromise) {
					if ('abort' in this._ssl_loadPromise) {
						this._ssl_loadPromise.abort();
					}

					this._ssl_loadPromise = null;
				}

				if (this._ssl_loadDataChunkOnFailure) {
					this._ssl_loadDataChunkOnFailure(new StreamListLoadError(
						"StreamList load aborted.",
						0, null, null, true
					));

					this._ssl_loadDataChunkOnFailure = null;
				}
			},

			/**
			 * Renders all remaining items to the list.
			 * @public
			 */
			renderAll: function () {
				this._ssl_syncingAll = true;
				this._ssl_syncView();
			},

			addEventListener: function (aEventType, aListener, aOptions) {
				this._ssl_eventTarget.addEventListener(aEventType, aListener, aOptions);
			},

			removeEventListener: function (aEventType, aListener, aOptions) {
				this._ssl_eventTarget.removeEventListener(aEventType, aListener, aOptions);
			},

			/**
			 * Loads a chunk of item results via the adapter, starting from aOffset.
			 * Calls _ssl_handleLoadDataChunkTimeout().
			 * @param {*} aContext - @see StreamList#load
			 * @param {int} aOffset - The starting offset.
			 * @param {function=} aOnSuccess
			 * @param {function=} aOnFailure
			 * @param {int} aDelay
			 * @private
			 */
			_ssl_loadDataChunk: function (aContext, aOffset, aOnSuccess, aOnFailure, aDelay) {
				clearTimeout(this._ssl_loadDataChunkTimeout);

				this._ssl_loadDataChunkTimeout = setTimeout(
					this._ssl_handleLoadDataChunkTimeout, aDelay,
					aContext, aOffset, aOnSuccess, aOnFailure
				);
			},

			/**
			 * Called by _ssl_loadDataChunk().
			 * @param aContext
			 * @param aOffset
			 * @param aOnSuccess
			 * @param aOnFailure
			 * @private
			 */
			_ssl_handleLoadDataChunkTimeout: function (aContext, aOffset, aOnSuccess, aOnFailure) {
				var loadPromise;

				//keep a reference to any failure handler, which will get called if all retries fail
				this._ssl_loadDataChunkOnFailure = aOnFailure;

				//whether we are replacing all existing data or not
				var replace = aOffset == 0;

				if (this._ssl_hasMoreData || replace) {
					//load items via the adapter, storing the promise for use as a 'currently executing' flag
					new Promise(function (resolve) {
						loadPromise = this._ssl_adapter.loadItems(aContext, aOffset);
						this._ssl_loadPromise = loadPromise;
						resolve(loadPromise);

						if (this._ssl_logLevel >= LOG_LEVEL_NOTICE) {
							this._ssl_logger.info("Loading data from offset " + aOffset + ".");
						}
					}.bind(this))
					.then(function (r) {
						//if the the promises don't match, it indicates that the load was aborted.
						//We just ignore the result here, as it will get handled by abort() itself
						if (this._ssl_loadPromise === loadPromise) {
							if (!(r && ('items' in r))) throw new StreamListLoadError(
								"Invalid load result. Key 'items' must be of type Array.",
								0, null, r, false
							);

							this._ssl_hasMoreData = this._ssl_bindDataChunk(r.items, replace);

							if (!this._ssl_hasMoreData) {
								if (this._ssl_logLevel >= LOG_LEVEL_NOTICE) {
									this._ssl_logger.info("Reached end of data.");
								}
							}

							if (replace) {
								this._ssl_loadInfo = aContext;
							}

							this._ssl_loadPromise = null;
							this._ssl_loadRetryIndex = 0;
							this._ssl_loadDataChunkOnFailure = null;

							//sync the view to check if we should show any new items
							this._ssl_syncView();

							if (aOnSuccess) {
								aOnSuccess(r);
							}
						}
					}.bind(this))
					.catch(function (e) {
						this._ssl_loadPromise = null;
						this._ssl_loadDataChunkOnFailure = null;
						var msg = "Loading data failed.";

						//if we should retry
						if (this._ssl_loadRetryIndex < this._ssl_loadRetryCount) {
							msg += " Retrying in " + this._ssl_loadRetryDelay + "ms.";
							this._ssl_loadRetryIndex++;

							//load the data chunk again after a delay
							this._ssl_loadDataChunk(aContext, aOffset, aOnSuccess, aOnFailure, this._ssl_loadRetryDelay);
						}

						else {
							msg += " Will not retry.";

							if (aOnFailure) {
								aOnFailure(e);
							}
						}

						if (this._ssl_logLevel >= LOG_LEVEL_ERROR) {
							this._ssl_logger.error(msg, {
								exception: e,
							});
						}
					}.bind(this));
				}
			},

			/**
			 * Adds the loaded items to the store.
			 * @param {Array} aResults
			 * @param {boolean} aReplace
			 * @returns {boolean} Whether any items were added to the store.
			 * @private
			 */
			_ssl_bindDataChunk: function (aResults, aReplace) {
				var replace = aReplace != null ? aReplace : true;

				//holds the keys of all items we encountered during this call
				var chunkItemsSet = new Set();

				//holds the items we accepted during this call (i.e. excludes duplicates)
				var chunkItemsList = [];
				var i, len, result, itemKey, item, added, discarded, msg;

				for (i = 0, len = aResults.length; i < len; i++) {
					result = aResults[i];
					itemKey = this._ssl_adapter.getItemKey(result);

					//if the item is not already in the current chunk
					if (!chunkItemsSet.has(itemKey)) {
						// get any existing matching item in the overall list
						item = this._ssl_itemsMap.get(itemKey);

						//if we already have the item in the overall list
						if (item) {
							//if we are replacing results
							if (replace) {
								if (this.reuseResults) {
									// add the existing item
									chunkItemsList.push(item);
								}
								else {
									// add the new item
									chunkItemsList.push({
										result: result,
										key: itemKey,
									})
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
					this._ssl_itemsMap.clear();
					this._ssl_itemsList.splice(0);
					this._ssl_itemsListIndex = 0;
				}

				for (i = 0, len = chunkItemsList.length; i < len; i++) {
					item = chunkItemsList[i];

					this._ssl_itemsList.push(item);
					this._ssl_itemsMap.set(item.key, item);
				}

				if (this._ssl_logLevel >= LOG_LEVEL_NOTICE) {
					added = chunkItemsList.length;
					discarded = chunkItemsSet.size - added;

					msg = "Added " + added + " items.";
					if (discarded > 0) msg += " Discarded " + discarded + " duplicates.";

					this._ssl_logger.info(msg);
				}

				return chunkItemsList.length > 0;
			},

			/**
			 * Displays a number of items by appending them to the container.
			 * @returns {int} The number of items loaded but not yet displayed.
			 * @private
			 */
			_ssl_bindViewChunk: function () {
				var chunk = document.createDocumentFragment();
				var chunkActualSize = 0;
				var i, item;

				for (
					i = 0;
					i < this._ssl_viewChunkSize && this._ssl_itemsListIndex < this._ssl_itemsList.length;
					i++, this._ssl_itemsListIndex++
				) {
					item = this._ssl_itemsList[this._ssl_itemsListIndex];

					//if the item hasn't been rendered yet (i.e. created the <li> element)
					if (!item.element) {
						item.element = this._ssl_adapter.renderItem(item.result, this._ssl_container);
					}

					chunk.appendChild(item.element);
					chunkActualSize++;
				}

				if (chunkActualSize > 0) {
					this._ssl_container.appendChild(chunk);

					if (this._ssl_eventTarget.hasEventListeners('render-chunk')) {
						this._ssl_eventTarget.dispatchEvent(this, {
							type: 'render-chunk',
							target: this,
						});
					}
				}

				return this._ssl_itemsList.length - this._ssl_itemsListIndex;
			},

			/**
			 * Checks if there are more items that need to be displayed.
			 * This is called from scroll event handlers, etc.
			 * Calls _ssl_handleSyncViewTimeout().
			 * @private
			 */
			_ssl_syncView: function () {
				cancelAnimationFrame(this._ssl_syncViewTimeout);
				this._ssl_syncViewTimeout = requestAnimationFrame(this._ssl_handleSyncViewTimeout);
			},

			/**
			 * Called by _ssl_syncView().
			 * @private
			 */
			_ssl_handleSyncViewTimeout: function () {
				var itemsLeftCount, doStep, distance, viewportScrollY;

				if (this._ssl_itemsListIndex == 0) {
					while (this._ssl_container.hasChildNodes()) {
						this._ssl_container.removeChild(this._ssl_container.lastChild);
					}
				}

				if (this._ssl_syncingAll) {
					doStep = true;
				}
				else {
					viewportScrollY = window.scrollY;
					if (viewportScrollY == undefined) viewportScrollY = document.documentElement.scrollTop; //ie11

					distance =
						(viewportScrollY + window.innerHeight)
						- (DomUtils.offsetTop(this._ssl_container) + this._ssl_container.offsetHeight);

					doStep = distance >= (this._ssl_displayThreshold * -1);
				}

				if (doStep) {
					itemsLeftCount = this._ssl_bindViewChunk();

					if (itemsLeftCount > 0) {
						this._ssl_syncView();
					}

					else {
						if (!this._ssl_hasMoreData) {
							window.removeEventListener('scroll', this._ssl_handleUnthrottledReflow);
							window.removeEventListener('resize', this._ssl_handleUnthrottledReflow);
						}
					}

					if (this._ssl_hasMoreData) {
						if (!this._ssl_loadPromise) {
							if (itemsLeftCount < this._ssl_preloadThreshold) {
								this._ssl_loadDataChunk(this._ssl_loadInfo, this._ssl_itemsList.length, null, null, 0);
							}
						}
					}
				}
			},

			/**
			 * Event handler for scroll, resize, etc.
			 * Calls _ssl_handleReflow().
			 * @private
			 */
			_ssl_handleUnthrottledReflow: function () {
				cancelAnimationFrame(this._ssl_handleUnthrottledReflowTimeout);
				this._ssl_handleUnthrottledReflowTimeout = requestAnimationFrame(this._ssl_handleReflow);
			},

			/**
			 * Called by _ssl_handleUnthrottledReflow().
			 * @private
			 */
			_ssl_handleReflow: function () {
				this._ssl_syncView();
			},
		});

		/**
		 * @membersOf StreamList
		 */
		Object.defineProperties(StreamList.prototype, {
			/**
			 * @memberOf StreamList
			 * @public
			 */
			preloadThreshold: {
				get: function () {
					return this._ssl_preloadThreshold;
				},

				set: function (v) {
					var vv = parseInt(v);

					if (!(!isNaN(vv) && v >= 0)) throw new Error(
						"Invalid preloadThreshold '" + v + "'."
					);

					this._ssl_preloadThreshold = vv;
				},
			},

			/**
			 * @memberOf StreamList
			 * @public
			 */
			loadRetryCount: {
				get: function () {
					return this._ssl_loadRetryCount;
				},

				set: function (v) {
					var vv = parseInt(v);

					if (!(!isNaN(vv) && v >= 0)) throw new Error(
						"Invalid loadRetryCount '" + v + "'."
					);

					this._ssl_loadRetryCount = vv;
				},
			},

			/**
			 * @memberOf StreamList
			 * @public
			 */
			loadRetryDelay: {
				get: function () {
					return this._ssl_loadRetryDelay;
				},

				set: function (v) {
					var vv = parseInt(v);

					if (!(!isNaN(vv) && v >= 0)) throw new Error(
						"Invalid loadRetryDelay '" + v + "'."
					);

					this._ssl_loadRetryDelay = vv;
				},
			},

			/**
			 * @memberOf StreamList
			 * @public
			 */
			displayThreshold: {
				get: function () {
					return this._ssl_displayThreshold;
				},

				set: function (v) {
					var vv = parseInt(v);

					if (!(!isNaN(vv) && v >= 0)) throw new Error(
						"Invalid displayThreshold '" + v + "'."
					);

					this._ssl_displayThreshold = vv;
				},
			},

			/**
			 * @memberOf StreamList
			 * @public
			 */
			viewChunkSize: {
				get: function () {
					return this._ssl_viewChunkSize;
				},

				set: function (v) {
					var vv = parseInt(v);

					if (!(!isNaN(vv) && v > 0)) throw new Error(
						"Invalid viewChunkSize '" + v + "'."
					);

					this._ssl_viewChunkSize = vv;
				},
			},

			/**
			 * @memberOf StreamList
			 * @public
			 */
			logLevel: {
				get: function () {
					return this._ssl_logLevel;
				},

				set: function (v) {
					var vv = parseInt(v);

					if (!(!isNaN(vv) && v >= 0)) throw new Error(
						"Invalid logLevel '" + v + "'."
					);

					this._ssl_logLevel = vv;
				},
			},

			/**
			 * @memberOf StreamList
			 * @public
			 */
			logger: {
				get: function () {
					return this._ssl_logger;
				},

				set: function (v) {
					if (!(v && ('info' in v) && ('error' in v) && ('warn' in v) && ('debug' in v))) throw new Error(
						"Logger object must implement methods error(), warn(), info(), debug()."
					);

					this._ssl_logger = v;
				},
			},
		});

		return StreamList;
	}
);
