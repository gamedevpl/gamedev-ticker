define("Ticker", ["dojo/_base/Deferred", "dojo/string", "dojo/on", "dojo/regexp"], function(Deferred, string, on, regexp) {
		function defer(fn) {
			var deferred = {};
			return function() {
				var arg = JSON.stringify(arguments);
				if(deferred[arg])
					return deferred[arg];
				var result = deferred[arg] = new Deferred();
				result.then(function() {
					delete deferred[arg];
				});
				fn.apply(result, arguments);
				return result;
			}
		}

		var OPTS_MAX_AGE = 1000 * 60 * 30;//*0+1;
		var EVTS_MAX_AGE = 1000 * 60 * 30;//*0+1;
		var EVTS_LIMIT = 128;
		
		var keyOpts = function() { return "tickerOpts" }
		var keyEvents = function(filter, offset, limit) { return "tickerEvts_"+(filter||null)+"_"+(offset||null)+"_"+(limit||null) }
		
		var getStored = function(key, maxAge) {
			var result;
			try {
				result = JSON.parse(localStorage[key]);
			} catch(e) {
				return null;
			}
			
			if(result && (!maxAge || new Date().getTime() - result.time < maxAge))
				return result.value;
		}
		
		var store = function(key, value) {
			localStorage[key] = JSON.stringify({ time: new Date().getTime(), value: value });
			return value;
		}
		
		var clearStore = function(key) {
			localStorage.removeItem(key);
		}

		var getOpts = defer(function() {
			var storedOpts = getStored(keyOpts(), OPTS_MAX_AGE);

			if (storedOpts)
				this.resolve(storedOpts);
			else
				remote({ action: "getOpts" }).then(function(result) {
					this.resolve(store(keyOpts(), result));
				}.bind(this));
		});

		var getOptStats = defer(function(id) {
			this.resolve({ count: 0 });
		});
		
		var listEvents = defer(function(filter, offset) {
			var storedEvents = getStored(keyEvents(filter, offset, EVTS_LIMIT), EVTS_MAX_AGE);						
			if(storedEvents)
				this.resolve(storedEvents)
			else 
			{
				// we have no exact match in stored events and thats where the fun starts!
				var keyMatch = new RegExp('^'+keyEvents('(null|'+filter+')', '(\\d+|null)', '(\\d+|null)'));
				var merged = offset && (getStored("eventKeys")||[]).filter(function(key) { return keyMatch.test(key); }).
					map(function(key) { return getStored(key, EVTS_MAX_AGE) } ).filter(function(events) { return events != null }).
					map(function(events) {
						return events.filter(function(event) {
							return event.tu < offset; 
						})
					}).reduce(function(r, events) {
						return (r = r.concat(events));
					}, []) || 0;
					
				if(merged.length >= EVTS_LIMIT) {
					merged.sort(function(e1, e2) { return e1.tu > e2.tu ? -1 : 1 });
					this.resolve(merged)
				} else
					remote({ action: "getEvents", filter: filter, offset: offset && (offset*1000), limit: EVTS_LIMIT })
					.then(function(result) {
						var key = keyEvents(filter, offset, EVTS_LIMIT);
						
						this.resolve(store(key, result));
						
						var eventKeys = (getStored("eventKeys")||[]);						
						if(eventKeys.indexOf(key)==-1)
							eventKeys.push(key);
						store("eventKeys", eventKeys);
					}.bind(this));
			}
		});
		
		var current = new Deferred();
		current.resolve();
		var remote = defer(function(content) {	
			var deferred;
			current.then(function() {				
				dojo.xhrPost({ url: "/ticker", content: content}).then(function(result) {
					this.resolve(JSON.parse(result));
					deferred.resolve();
				}.bind(this));
			}.bind(this).later(0));			
			deferred = current = new Deferred();
		});

		var TPL_OPT = '<i class="${icon}"> </i> <b>${title}</b> ';
		var TPL_EVENT = '<a href="${url}" class="ticker-link" title="${title}"> </a> ' + // 
		'<span class="group"><i class="${icon}"> </i> <span><b><i class="${icon}"> </i> ${groupTitle}</b></span></span> ' + //
		'${title_part} <i class="ts"><a href="${url}">${ts}</a></i>' +//
		'<div class="clb"> </div>';
		var TPL_TITLE = {
			DEFAULT: '<a href="${url}">${title}</a> <span class="user">${user_name}</span>',
			comments: '<span class="user">${user_name}</span> w <a href="${url}">${title}</a>',
			answer: '<span class="user">${user_name}</span> odpowiada na <a href="${url}">${title}</a>',
			question: '<span class="user">${user_name}</span> zadaje pytanie <a href="${url}">${title}</a>',
			"project-join": '<span class="user">${user_name}</span> dołącza do <a href="${url}">${title}</a>'
		};

		return {
			init: function(tickerNode) {
				var optsNode = dojo.create('form', { innerHTML: '<label>Filtr:</label>' }, tickerNode, 'first');
				var optsNodeClb = dojo.create('div', { className: 'clb' }, optsNode, 'last');
				var listNode = dojo.create('ul', { }, tickerNode);
				
				var filters = {};				
				getOpts().then(function(opts) {
					var optMap = {};
					
					/* opts */
					
					opts.some(function(opt) {
						var optNode = dojo.create('label', {
								className: 'filter',
								innerHTML: string.substitute(TPL_OPT, opt)
							}, optsNodeClb, 'before');
						
						getOptStats(opt.id).then(function(stats) {
							if (stats.count > 0)
								dojo.create('span', { innerHTML: stats.count }, optNode, 'last');
						})
						
						filters[opt.id] = getStored('tickerFilter-'+opt.id)==true;
						dojo.toggleClass(optNode, '-filter', filters[opt.id]);
						
						optMap[opt.id] = opt;
						opt.node = optNode;
						
						dojo.query(optNode).on('click', function(event) {
							event.preventDefault();
							dojo.toggleClass(optNode, '-filter');
							store('tickerFilter-'+opt.id, (filters[opt.id] = dojo.hasClass(optNode, '-filter')));
							
							loadEvents(activeFilters(), input.value);
						});
					})			
					
					/* events */

					function loadEvents(filters, query, offset, append) {
						var result = new Deferred();

						dojo.addClass(refreshNode, 'active');
						result.then(function() { dojo.removeClass(refreshNode, 'active'); }.later(100));						
						
						if(query)
							query = new RegExp(regexp.escapeString(query), "gi");

						(filters && filters[0] && filters || Object.keys(optMap)).some(function(id) {
							dojo.addClass(optMap[id].node, 'loading');
						});
						
						if(!filters || !filters[0])
							result.then(function() {
								Object.keys(optMap).some(function(id) {
									dojo.removeClass(optMap[id].node, 'loading');
								});
							});
						
						filters = filters&&filters[0]&&filters||[null];
						if(!append)
							dojo.query('>*', listNode).orphan();
						
						var counter = 0;												
						filters.some(function(filter) {
							counter++;
							var handler;
							listEvents(filter, offset).then(handler = function(events) {														
								var node = listNode.firstChild;
								var nodeCount = dojo.query('li', listNode).length;
								
								if(filter)
									dojo.removeClass(optMap[filter].node, 'loading');
								
								events.some(function(event) {
									if(filter && event.group != filter)
										return;
									try {
										var opt = optMap[event.group];
										event.icon = opt.icon;
										event.groupTitle = opt.title;
										event.title_part = string.substitute(TPL_TITLE[opt.group] || TPL_TITLE[event.group] || TPL_TITLE.DEFAULT, event);
										
										if(query)
											if(!Object.keys(event).some(function(key) {
												if(event[key].match(query))
													return true;
											}))
												return;
																													
										var eventNode = dojo.create('li', { innerHTML: string.substitute(TPL_EVENT, event) }, listNode);
										eventNode.event = event;

										while(node && node.event.tu > event.tu)
											node = node.nextSibling;	
										
										if(listNode.lastChild && listNode.lastChild.event.tu > event.tu)
											return true;
										else if(node)
											dojo.place(eventNode, node, 'before');
										else
											dojo.place(eventNode, listNode);
											
										if(nodeCount++ >= 32)
											return true;
									} catch(e) {
										console.log(event);
									}
								})
								
								var nodes = dojo.query('li', listNode);
								
								if(!append && nodes.length >= 32)
									nodes.filter(function(node, idx) { return idx > 32 }).orphan();
								else if(events.length == EVTS_LIMIT) {
									counter++;
									listEvents(filter, (events[events.length-1].tu-1)).then(handler);
								}
								
								if(--counter <= 0)
									result.resolve();	
							}.later(0));
						})
						
						return result;
					}
					
					/* utils, search, refresh */
					
					var utilNode = dojo.create('label', { className: 'util'}, optsNode, 'first');
					var refreshNode = dojo.create('i', { className: 'icon-refresh' }, utilNode, 'last');
					dojo.connect(refreshNode, 'click', function(event) {
						event.preventDefault();
												
						[{id: null}].concat(opts).some(function(opt) {
							clearStore(keyEvents(opt.id, null, EVTS_LIMIT));
						});
						
						loadEvents(activeFilters(), input.value);
					});
					
					 var searchNode = dojo.create('span', { innerHTML: '<input type="textbox" required placeholder="Szukaj"/><i class="icon-remove-circle"> </i><i class="icon-search"> </i>' }, utilNode, 'first');
					 var input = dojo.query('input', searchNode)[0];
					 dojo.query('.icon-search', searchNode).on('click', function() {
						on.emit(optsNode, "submit", {}); 
					 });
					 function resetInput() {
						input.value = null;
						on.emit(optsNode, "submit", {}); 
					 }
					 dojo.query('.icon-remove-circle', searchNode).on('click', resetInput);
					 dojo.query('input', searchNode).on('keydown', function(event) {
						 if(event.keyCode == dojo.keys.ESCAPE)
							 resetInput();						 
					 });
					 dojo.connect(optsNode, 'submit', function(event) {
						event.preventDefault();
						loadEvents(activeFilters(), input.value);
					 });
					
					 
					// initial load of events
					loadEvents(activeFilters(), input.value);
				});
				
				function activeFilters() {
					return Object.keys(filters).filter(function(key) { return filters[key] });
				}
			}
		}
	});