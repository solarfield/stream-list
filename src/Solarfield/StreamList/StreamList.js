define(
	'solarfield/stream-list/src/Solarfield/StreamList/StreamList',
	[
		'solarfield/ok-kit-js/src/Solarfield/Ok/ObjectUtils',
		'solarfield/ok-kit-js/src/Solarfield/Ok/DomUtils',
	],
	function (ObjectUtils, DomUtils) {
		"use strict";
		
		const LOG_LEVEL_ERROR = 3;
		const LOG_LEVEL_NOTICE = 5;
		
		/**
		 * @class StreamList
		 */
		let StreamList = ObjectUtils.extend(Object, {
			/**
			 * @constructor
			 * @param {Object} aOptions
			 * @param {HTMLElement} aOptions.container
			 * @param {StreamListAdapter} aOptions.adapter
			 * @param {int=} aOptions.viewChunkSize - Number of items appended to document during each render pass.
			 * @param {int=} aOptions.displayThreshold - Number of pixels from end of list, that will trigger a render pass.
			 * @param {int=} aOptions.preloadThreshold - Number of items from end of data, that will trigger a data load.
			 * @param {int=} aOptions.loadRetryCount - Number of retries if data loading failed.
			 * @param {int=} aOptions.loadRetryDelay - Delay before retrying data load, in milliseconds.
			 * @param {Object=} aOptions.logger
			 * @param {int=} aOptions.logLevel - @see https://tools.ietf.org/html/rfc5424#page-11
			 */
			constructor: function (aOptions) {
				this._ssl_loadDataChunk = this._ssl_loadDataChunk.bind(this);
				this._ssl_handleSyncViewTimeout = this._ssl_handleSyncViewTimeout.bind(this);
				this._ssl_handleReflow = this._ssl_handleReflow.bind(this);
				this._ssl_handleUnthrottledReflow = this._ssl_handleUnthrottledReflow.bind(this);
				
				this._ssl_container = aOptions.container;
				this._ssl_adapter = aOptions.adapter;
				this._ssl_itemsList = [];
				this._ssl_itemsListIndex = 0;
				this._ssl_itemsMap = new Map();
				this._ssl_syncViewTimeout = null;
				this._ssl_loadPromise = null;
				this._ssl_loadInfo = null;
				this._ssl_loadRetryDelay = null;
				this._ssl_loadRetryIndex = 0;
				this._ssl_loadRetryCount = null;
				this._ssl_loadDataChunkTimeout = 0;
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
				
				this.preloadThreshold = aOptions.preloadThreshold != null
					? aOptions.preloadThreshold : this._ssl_viewChunkSize * 2;
			},
			
			/**
			 * Loads the list item data, replacing any previously loaded data.
			 * @param {*=} aContext - Generic info which can be used to provide context to the load process.
			 *  e.g. a URL query string, search filters, etc.
			 *  The type/content of this object is defined by the associated StreamListAdapter.
			 * @public
			 * @see StreamListAdapter#loadItems
			 */
			load: function (aContext) {
				window.addEventListener('scroll', this._ssl_handleUnthrottledReflow);
				window.addEventListener('resize', this._ssl_handleUnthrottledReflow);
				this._ssl_loadDataChunk(aContext, 0);
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
			},
			
			/**
			 * Loads a chunk of item results via the adapter, starting from aOffset.
			 * @param {*} aContext - @see StreamList#load
			 * @param {int} aOffset - The starting offset.
			 * @private
			 */
			_ssl_loadDataChunk: function (aContext, aOffset) {
				this.abort();
				
				//whether we are replacing all existing data or not
				let replace = aOffset == 0;
				
				if (this._ssl_hasMoreData || replace) {
					//load items via the adapter, storing the promise for use as a 'currently executing' flag
					this._ssl_loadPromise = new Promise(function (resolve) {
						resolve(this._ssl_adapter.loadItems(aContext, aOffset));
						
						if (this._ssl_logLevel >= LOG_LEVEL_NOTICE) {
							this._ssl_logger.info("Loading data from offset " + aOffset + ".");
						}
					}.bind(this));
					
					this._ssl_loadPromise
					.then(function (r) {
						if (!(r && ('items' in r))) throw new Error(
							"Invalid load result. Key 'items' must be of type Array.", {
								response: r,
							}
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
						
						//sync the view to check if we should show any new items
						this._ssl_syncView();
					}.bind(this))
					.catch(function (e) {
						this._ssl_loadPromise = null;
						let msg = "Loading data failed.";
						
						//if we should retry
						if (this._ssl_loadRetryIndex < this._ssl_loadRetryCount) {
							msg += " Retrying in " + this._ssl_loadRetryDelay + "ms.";
							this._ssl_loadRetryIndex++;
							
							//load the data chunk again after a delay
							setTimeout(this._ssl_loadDataChunk, this._ssl_loadRetryDelay, aContext, aOffset);
						}
						
						else {
							msg += " Will not retry.";
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
				const replace = aReplace != null ? aReplace : true;
				
				//holds the keys of all items we encountered during this call
				const chunkItemsSet = new Set();
				
				//holds the items we accepted during this call (i.e. excludes duplicates)
				const chunkItemsList = [];

				for (let result of aResults) {
					let itemKey = this._ssl_adapter.getItemKey(result);

					//discard duplicates in the passed result list
					if (!chunkItemsSet.has(itemKey)) {
						//check if we already have the item
						let item = this._ssl_itemsMap.get(itemKey);

						//if we already have the item
						if (item) {
							//add the item if we are replacing, otherwise discard it as a duplicate
							if (replace) {
								chunkItemsList.push(item);
							}
						}

						//else we don't have the item yet
						else {
							item = {
								result: result,
								key: itemKey,
							};

							chunkItemsList.push(item);
							this._ssl_itemsMap.set(itemKey, item);
						}

						chunkItemsSet.add(itemKey);
					}
				}

				if (replace) {
					this._ssl_itemsMap.clear();
					this._ssl_itemsList.splice(0);
					this._ssl_itemsListIndex = 0;
				}

				for (let item of chunkItemsList) {
					this._ssl_itemsList.push(item);
					this._ssl_itemsMap.set(item.key, item);
				}
				
				if (this._ssl_logLevel >= LOG_LEVEL_NOTICE) {
					let added = chunkItemsList.length;
					let discarded = chunkItemsSet.size - added;
					
					let msg = "Added " + added + " items.";
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
				let chunk = document.createDocumentFragment();
				let chunkActualSize = 0;

				for (
					let i = 0;
					i < this._ssl_viewChunkSize && this._ssl_itemsListIndex < this._ssl_itemsList.length;
					i++, this._ssl_itemsListIndex++
				) {
					let item = this._ssl_itemsList[this._ssl_itemsListIndex];

					//if the item hasn't been rendered yet (i.e. created the <li> element)
					if (!item.element) {
						item.element = this._ssl_adapter.renderItem(item.result, this._ssl_container);
					}

					chunk.appendChild(item.element);
					chunkActualSize++;
				}

				if (chunkActualSize > 0) {
					this._ssl_container.appendChild(chunk);
				}

				return this._ssl_itemsList.length - this._ssl_itemsListIndex;
			},
			
			_ssl_syncView: function () {
				cancelAnimationFrame(this._ssl_syncViewTimeout);
				this._ssl_syncViewTimeout = requestAnimationFrame(this._ssl_handleSyncViewTimeout);
			},
			
			_ssl_handleSyncViewTimeout: function () {
				if (this._ssl_itemsListIndex == 0) {
					while (this._ssl_container.hasChildNodes()) {
						this._ssl_container.lastChild.remove();
					}
				}
				
				let distance =
					(window.scrollY + window.innerHeight)
					- (DomUtils.offsetTop(this._ssl_container) + this._ssl_container.offsetHeight);
				
				if (distance >= (this._ssl_displayThreshold * -1)) {
					let itemsLeftCount = this._ssl_bindViewChunk();
					
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
								this._ssl_loadDataChunk(this._ssl_loadInfo, this._ssl_itemsList.length);
							}
						}
					}
				}
			},
			
			_ssl_handleReflow: function () {
				this._ssl_syncView();
			},
			
			_ssl_handleUnthrottledReflow: function () {
				cancelAnimationFrame(this._ssl_handleUnthrottledReflowTimeout);
				this._ssl_handleUnthrottledReflowTimeout = requestAnimationFrame(this._ssl_handleReflow);
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
				get() {
					return this._ssl_preloadThreshold;
				},
				
				set (v) {
					let vv = parseInt(v);
					
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
				get() {
					return this._ssl_loadRetryCount;
				},
				
				set (v) {
					let vv = parseInt(v);
					
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
				get() {
					return this._ssl_loadRetryDelay;
				},
				
				set (v) {
					let vv = parseInt(v);
					
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
				get() {
					return this._ssl_displayThreshold;
				},
				
				set (v) {
					let vv = parseInt(v);
					
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
				get() {
					return this._ssl_viewChunkSize;
				},
				
				set (v) {
					let vv = parseInt(v);
					
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
				get() {
					return this._ssl_logLevel;
				},
				
				set (v) {
					let vv = parseInt(v);
					
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
				get() {
					return this._ssl_logger;
				},
				
				set (v) {
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