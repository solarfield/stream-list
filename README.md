# stream-list
Dynamically populates a list of HTML elements.

# Features
- Completely customizable data source and element creation via StreamListAdapter class
- Automatically loads data as needed
- Automatically renders items as needed (based on viewport scroll position)
- Obeys requestAnimationFrame() for async calls to avoid jank
- Adds DOM event listeners only when needed
- Automatically detects & discards duplicate items encountered in data stream
- Automatically detects end of data in stream (i.e. no more items available)
- Reuses item data & elements across consecutive calls to load()
- Imposes zero constraints on the data structure, or DOM structure of items. This is entirely defined by the adapter.
- Load execution is explicit via a load() method call. This method accepts an optional 'context' object argument which
    is defined by the adapter and can be used to provide filters, or any other instruction to the underlying load 
    process. 
- Supports external logger/console and log levels defined by RFC 5424
- Many configurable properties. See constructor for more info.
- Promise based API
- AMD module

# Compatibility
- Any modern browser or IE11+
