define("Ticker", ["dojo/_base/Deferred", "dojo/string"], function(Deferred, string) {
		function deferred(fn) {
			return function() {
				var deferred = new Deferred();
				fn.apply(deferred, arguments);
				return deferred;
			}
		}

		var OPTS_MAX_AGE = 0;//1000 * 60 * 60 * 48;
		var EVTS_MAX_AGE = 0;//1000 * 60 * 60 * 48;
		
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

		var getOpts = deferred(function() {
			var storedOpts = getStored("tickerOpts", OPTS_MAX_AGE);

			if (storedOpts)
				this.resolve(storedOpts);
			else
				dojo.xhrPost({ url: '/ticker', content: { action: "getOpts" } }).then(function(result) {
					this.resolve(store("tickerOpts", JSON.parse(result)));
				}.bind(this));
		});

		var getOptStats = deferred(function(id) {
			this.resolve({ count: 0 });
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
			question: '<span class="user">${user_name}</span> zadaje pytanie <a href="${url}">${title}</a>'
		};

		var listEvents = deferred(function(filter) {
			var storedEvents = getStored("tickerEvents_"+filter, EVTS_MAX_AGE);
			if(storedEvents)
				this.resolve(storedEvents)
			else
				dojo.xhrPost({ url: "/ticker", content: { action: "getEvents", filter: filter } }).then(function(result) {
					this.resolve(store("tickerEvents_"+filter, JSON.parse(result)));
				}.bind(this));
		});

		return {
			init: function(tickerNode) {
				var optsNode = dojo.create('form', { innerHTML: '<label>Filtr:</label>' }, tickerNode, 'first');
				var optsNodeClb = dojo.create('div', { className: 'clb' }, optsNode, 'last');
				var listNode = dojo.create('ul', { }, tickerNode);

				var filters = {};
				
				getOpts().then(function(opts) {
					var optMap = {};
					
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
						
						dojo.query(optNode).on('click', function(event) {
							event.preventDefault();
							dojo.toggleClass(optNode, '-filter');
							store('tickerFilter-'+opt.id, (filters[opt.id] = dojo.hasClass(optNode, '-filter')));
							loadEvents(Object.keys(filters).filter(function(key) { return filters[key] }));
						});
					})				

					function loadEvents(filters) {
						filters = filters&&filters[0]&&filters||[null];
						dojo.query('>*', listNode).orphan();
						filters.some(function(filter) {
							listEvents(filter).then(function(events) {
								var node = listNode.firstChild;
								events.some(function(event) {
									if(filter && event.group != filter)
										return;
									try {
										var opt = optMap[event.group];
										event.icon = opt.icon;
										event.groupTitle = opt.title;
										event.title_part = string.substitute(TPL_TITLE[opt.group] || TPL_TITLE[event.group] || TPL_TITLE.DEFAULT, event);
																													
										var eventNode = dojo.create('li', { innerHTML: string.substitute(TPL_EVENT, event) }, listNode);
										eventNode.event = event;

										while(node && node.event.ts > event.ts)
											node = node.nextSibling;	
										
										if(node)
											dojo.place(eventNode, node, 'before');
										else
											dojo.place(eventNode, listNode);
											
									} catch(e) {
										console.log(event);
									}
								})
								
								dojo.query('li', listNode).filter(function(node, idx) { return idx > 32 }).orphan();
							});
						})
					}
					
					loadEvents(Object.keys(filters).filter(function(key) { return filters[key] }));
				});
			}
		}
	});