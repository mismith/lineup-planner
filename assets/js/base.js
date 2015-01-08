angular.module('firebaseHelper', ['firebase'])

	.service('$firebaseHelper', ['$firebase', '$q', function($firebase, $q){
		var self      = this,
			namespace = '',
			cached    = {};
		
		// get or set namespace/Firebase reference domain
		self.namespace = function(set){
			if(set !== undefined) namespace = set;
			return namespace;
		};
		
		// returns: Reference
		self.$ref = function(){
			var args = Array.prototype.slice.call(arguments);
			
			var path = 'Ref/' + args.join('/');
			if(cached[path]) return cached[path];
			
			var $ref = new Firebase('https://' + namespace + '.firebaseio.com/' + (args.join('/') || ''));
			cached[path] = $ref;
			
			return $ref;
		};
		
		// returns: Instance
		self.$inst = function(){
			if(arguments.length == 1 && arguments[0] instanceof Firebase){
				// accept/handle firebase $ref as argument too, not just string(s)
				var ref  = arguments[0],
					path = 'Inst' + ref.path;
				
				if(cached[path]) return cached[path];
				
				var $inst = $firebase(ref);
				cached[path] = $inst;
			
				return $inst;
			}else{
				// handle string(s)
				var args = Array.prototype.slice.call(arguments),
					path = 'Inst/' + args.join('/');
				if(cached[path]) return cached[path];
				
				var $inst = $firebase(self.$ref.apply(this, args));
				cached[path] = $inst;
			
				return $inst;
			}
		};
		
		// returns: Object or Array
		// i.e. if last argument === true, return Array instead of Object
		self.$get = function(){
			var args = Array.prototype.slice.call(arguments),
				type = 'Object';
			
			if(args[args.length - 1] === true){
				type = 'Array';
				args.pop();
			}
			
			// retrieve cached item, if possible
			var path = type + '/' + args.join('/');
			if(cached[path]) return cached[path];
			
			// retrieve from remote, then cache it for later
			var $get = self.$inst.apply(this, args)['$as'+type]();
			cached[path] = $get;
			
			return $get;
		};
		
		// returns: promise for Object or Array
		self.$load = function(){
			return self.$get.apply(this, arguments).$loaded();
		};
		
		// returns: Instance
		self.$child = function(){
			var args = Array.prototype.slice.call(arguments),
				parent = args.shift();
			
			if(angular.isFunction(parent.$inst)){ // it's a Firebase Object or Array
				parent = parent.$inst();
			}
			if(angular.isFunction(parent.$ref)){ // it's a Firebase Instance
				parent = parent.$ref();
			}
			if(angular.isFunction(parent.child)){ // it's a Firebase Reference
				return self.$inst(parent.child(args.join('/')));
			}
			return parent; // fallback to parent
		};
		
		self.$populate = function(keys, values, cbAdded){
			var array   = [],
				keysRef = self.$ref(keys);
			
			// fire callback even if no keys found
			keysRef.once('value', function(snapshot){
				if( ! angular.isObject(snapshot.val())){
					if(angular.isFunction(cbAdded)) cbAdded();
				}
			});
			
			// watch for additions/deletions at keysRef
			keysRef.on('child_added', function(snapshot){
				var $item = self.$get(values, snapshot.key());
				
				$item.$loaded().then(function(){
					var deferreds = [];
					if(angular.isFunction(cbAdded)) deferreds.push(cbAdded($item));
					
					$q.all(deferreds).then(function(){
						array.push($item);
					});
				});
			});
			keysRef.on('child_removed', function(snapshot){
				array.splice($rootScope.childById(array, snapshot.key(), undefined, true), 1);
			});
			return array;
		};
		
		// @requires: external Firebase.util library: https://github.com/firebase/firebase-util
		self.$intersect = function(keysPath, valuesPath, keysMap, valuesMap){
			if( ! Firebase.util) throw new Error('$firebaseHelper.$intersect requires Firebase.util external library. See: https://github.com/firebase/firebase-util');
			
			// @TODO: cache somehow
			
			var keysObj   = {ref: self.$ref(keysPath)},
				valuesObj = {ref: self.$ref(valuesPath)};
			
			if(keysMap)   keysObj.keyMap   = keysMap;
			if(valuesMap) valuesObj.keyMap = valuesMap;
			
			return $firebase(Firebase.util.intersection(keysObj, valuesObj)).$asArray();
		};
		
		return self;
	}]);
angular.module('coachella', ['ui.router', 'ui.bootstrap', 'firebase', 'firebaseHelper'])
	
	.config(["$locationProvider", "$urlRouterProvider", "$stateProvider", function($locationProvider, $urlRouterProvider, $stateProvider){
		$urlRouterProvider.when('',  '/');
		$urlRouterProvider.when('/', '/2015'); // default to current year
		$stateProvider
			// pages
			.state('year', {
				url: '/:year',
				templateUrl: 'views/year.html',
				resolve: {
					bands: ["$rootScope", "$stateParams", "$firebaseHelper", function($rootScope, $stateParams, $firebaseHelper){
						$rootScope.bands = $firebaseHelper.$get('bands/' + $stateParams.year, true);
						
						return true;
					}],
				},
			})
				.state('year.group', {
					url: '/:group',
					resolve: {
						group: ["$rootScope", "$stateParams", "$firebaseHelper", function($rootScope, $stateParams, $firebaseHelper){
							$rootScope.group = $firebaseHelper.$get('groups/' + $stateParams.year + '/' + $stateParams.group);
							
							$rootScope.users = $firebaseHelper.$get('users'); // @TODO: only load those in group
							
							return true;
						}],
					},
				})
			.state('year:edit', {
				url: '/:year/edit',
				templateUrl: 'views/edit.html',
				resolve: {
					authorization: ["$rootScope", "$q", function($rootScope, $q){
						var deferred = $q.defer();
					
						if($rootScope.$me.uid == 'facebook:120605287' /* Murray Smith */){
							deferred.resolve();
						}else{
							deferred.reject();
						}
						
						return deferred.promise;
					}],
				},
			});
	}])
	
	.controller('AppCtrl', ["$rootScope", "$state", "$firebase", "$firebaseHelper", "$firebaseAuth", function($rootScope, $state, $firebase, $firebaseHelper, $firebaseAuth){
		$firebaseHelper.namespace('coachellalp');
		$rootScope.$state = $state;
		
		$rootScope.$me = {};
		$rootScope.$auth = $firebaseAuth($firebaseHelper.$ref());
		$rootScope.$auth.$onAuth(function(authData){
			if(authData){
				// logging in
				$rootScope.$me = $firebaseHelper.$get('users/' + authData.uid); // fetch existing user profile
				$rootScope.$me.$inst().$update(authData); // update it w/ any changes since last login
				$rootScope.$me.$loaded().then(function(me){
					// check if user is already in a group this year, and redirect there if so
					if( ! $rootScope.group && me.groups && me.groups[$state.params.year]){
						$state.go('year.group', {year: $state.params.year, group: me.groups[$state.params.year]});
					}
				});
			}else{
				// load/refresh while not logged in, or logging out
			}
		});
	}])
	.controller('BandsCtrl', ["$scope", "$firebaseHelper", function($scope, $firebaseHelper){
		$scope.vote = function(band_id, vote){
			var save = function(user_id){
				var $item = $firebaseHelper.$child($scope.bands, band_id + '/votes/' + (user_id || $scope.$me.uid) + '/vote')
				$item.$asObject().$loaded().then(function(item){
					if(item.$value == vote){
						$item.$remove();
					} else {
						$item.$set(vote);
					}
				});
			}
			if ( ! $scope.$me.uid){
				$scope.$auth.$authWithOAuthPopup('facebook').then(function(authData){
					save(authData.uid);
				}, function(error){
					console.error(error);
				});
			}else{
				save();
			}
		};
		
		$scope.filterDay   = 0;
		$scope.orderBy     = undefined;
		$scope.orderByStr  = undefined;
		$scope.orderByDir  = false;
		$scope.toggleOrder = function(key){
			if(key){
				var defaultOrderByDirs = {
					day: false,
					name: false,
					vote: true,
					score: true,
				};
				if($scope.orderByStr == key){ // already sorting by this key
					if($scope.orderByDir === defaultOrderByDirs[key]){ // we haven't yet flipped direction
						$scope.orderByDir = ! $scope.orderByDir; // flip direction
					}else{// we've already flipped direction
						// clear the sorting to default
						return $scope.toggleOrder();
					}
				}else{ // sorting by new key
					$scope.orderByDir = defaultOrderByDirs[key]; // sort by default direction
				}
			}
			
			$scope.orderByStr = key;
			
			switch(key){
				case 'vote':
					key = function(item){
						var order = -2;
						if(item.votes){
							angular.forEach(item.votes, function(vote, user_uid){
								if(user_uid == $scope.$me.uid) order = vote.vote;
							});
						}
						return order;
					};
					break;
				case undefined:
					$scope.orderBy    = ['day','$id'];
					$scope.orderByDir = false;
					return;
				case 'day':
					$scope.orderBy    = ['day','name'];
					return;
			}
			$scope.orderBy = key;
		};
		$scope.toggleOrder();
		
		
		$scope.invite = function(){
			$scope.$apply(function(){
				FB.ui({
					method: 'apprequests',
					title: 'Coachella Friends',
					message: 'Let\'s figure out which bands we all want to see this year.',
				}, function(response){
					if( ! response){
						console.error('Facebook Error: Unknown');
					}else if(response.error){
						console.error('Facebook Error: ' + response.error);
					}else{
						if(response.to){
							// build list of user uids
							var uids = {};
							uids[scope.$me.uid] = scope.$me.uid; // include self
							angular.forEach(response.to, function(fbid){ // include invitees
								var uid = 'facebook:' + fbid;
								uids[uid] = uid;
							});
							console.log(uids);
							
							// update relations
	/*
							if(scope.group){
								// group already exists, append new users
								scope.group.$update({users: uids});
							}else{
								// create new group
								$firebaseHelper.$get('groups', true).$add({year: $state.params.year, users: uids}).then(function(groupRef){
									var groupId = groupRef.key();
									$firebaseHelper.$inst('users/' + $rootScope.$me.uid + '/groups').$set(groupId, groupId).then(function(){
										$state.go('year.group', {year: $state.params.year, group: groupId});
									});
								});
							}
	*/
						}
					}
				});
			});
		}
	}])
	.controller('BandCtrl', ["$scope", function($scope){
		$scope.init = function(band){
			$scope.data = band;
		};
		$scope.$watch('data.votes', function(votes){
			var total = 0;
			angular.forEach(votes, function(item){
				total += item.vote;
			});
			$scope.data = $scope.data || {};
			return $scope.data.score = total;
		});
		
		$scope.add = function(band){
			if(band && band.name && band.day){
				$scope.bands.$add(band).then(function(){
					// reset it
					band.name = '';
					
					// focus on input so we can quickly add more
					$scope.added = true;
				});
			}
		};
		$scope.remove = function(band, skipConfirm){
			if(band && band.$id && (skipConfirm || confirm('Are you sure you want to permanently delete this?'))){
				$scope.bands.$remove(band);
			}
		};
	}])
	
	.directive('ngAutofocus', function(){
		return {
			restrict: 'A',
			link: function(scope, element, attrs){
				scope.$watch(function(){
					return scope.$eval(attrs.ngAutofocus);
				},function (v){
					if(v) element[0].focus(); // use focus function instead of autofocus attribute to avoid cross browser problem. And autofocus should only be used to mark an element to be focused when page loads.
				});
			}
		};
	})