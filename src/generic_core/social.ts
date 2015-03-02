/**
 * social.ts
 *
 * Interactions for network-specific social providers.
 *
 * To add new social providers, list them as dependencies in the primary
 * uProxy freedom manifest (freedom-module.json) with the 'SOCIAL-' prefix
 * in the name.
 *
 * e.g.
 *
 *  "dependencies": {
 *    ...
 *    "SOCIAL-websocket": {
 *      "url": "../lib/websocket-server/social.ws.json",
 *      "api": "social"
 *    },
 *    ...
 */
/// <reference path='firewall.ts' />
/// <reference path='local-instance.ts' />
/// <reference path='user.ts' />
/// <reference path='util.ts' />
/// <reference path='../uproxy.ts' />
/// <reference path='../interfaces/network.d.ts' />
/// <reference path='../interfaces/persistent.d.ts' />

/// <reference path='../freedom/typings/freedom.d.ts' />
/// <reference path='../freedom/typings/social.d.ts' />
/// <reference path='../third_party/typings/es6-promise/es6-promise.d.ts' />


module Social {

  var LOGIN_TIMEOUT :number = 5000;  // ms


  // PREFIX is the string prefix indicating which social providers in the
  // freedom manifest we want to treat as social providers for uProxy.
  var PREFIX:string = 'SOCIAL-';
  // Global mapping of social network names (without prefix) to actual Network
  // instances that interact with that social network.
  //
  // TODO: rather than make this global, this should be a parameter of the core.
  // This simplified Social to being a SocialNetwork and removes the need for
  // this module. `initializeNetworks` becomes part of the core constructor.
  // TODO(salomegeo): Change structure of network
  export var networks:{[networkName:string] :{[userId:string]:Network}} = {};
  export var pendingNetworks:{[networkName:string]:Network} = {};

  export function removeNetwork(networkName :string, userId :string) {
    if (networkName !== MANUAL_NETWORK_ID) {
      delete networks[networkName][userId];
    }
    notifyUI(networkName);
  }

  /**
   * Goes through network names and gets a reference to each social provider.
   */
  export function initializeNetworks() {
    for (var dependency in freedom) {
      if (freedom.hasOwnProperty(dependency)) {
        if (dependency.indexOf(PREFIX) !== 0 ||
            'social' !== freedom[dependency].api) {
          continue;
        }

        var name = dependency.substr(PREFIX.length);
        networks[name] = {};
      }
    }

    // TODO: re-enable manual networks here when all code is ready
    // Social.networks[MANUAL_NETWORK_ID] = {
    //     '': new Social.ManualNetwork(MANUAL_NETWORK_ID)};
  }

  /**
   * Retrieves reference to the network |networkName|.
   */
  export function getNetwork(networkName :string, userId :string) : Network {
    if (!(networkName in networks)) {
      console.warn('Network does not exist: ' + networkName);
      return null;
    }

    if (!(userId in networks[networkName])) {
      console.log('Not logged in with userId ' + userId + ' in network ' + networkName);
      return null;
    }
    return networks[networkName][userId];
  }

  export function notifyUI(networkName :string) {
    var userId = '';
    var online = false;
    if (Object.keys(networks[networkName]).length > 0) {
      online = true;
      // Hack. Once we have a support for multiple networks in ui
      // we'll change this.
      userId = (Object.keys(networks[networkName]))[0];
    };
    var payload :UI.NetworkMessage = {
      name: networkName,
      online: online,
      userId: userId
    };
    ui.update(uProxy.Update.NETWORK, payload);
  }

  // Implements those portions of the Network interface for which the logic is
  // common to multiple Network implementations. Essentially an abstract base
  // class for Network implementations, except that TypeScript does not allow
  // abstract classes.
  export class AbstractNetwork implements Network {

    public roster     :{[userId: string] :Core.User};
    public myInstance :Core.LocalInstance;

    private SaveKeys = {
      ME: 'me'
    }

    constructor(public name :string) {
      this.roster = {};
    }

    public getStorePath = () : string => {
      return this.myInstance.instanceId + '/roster/';
    }

    /**
     * Returns the local instance. If it doesn't exist, load local instance
     * from storage, or create a new one if this is the first time this uProxy
     * installation has interacted with this network.
     */
    public prepareLocalInstance = (userId :string) : Promise<void> => {
      var key = this.name + userId;
      return storage.load<Instance>(key).then((result :Instance) => {
        console.log(JSON.stringify(result));
        this.myInstance = new Core.LocalInstance(this, userId, result);
        this.log('loaded local instance from storage: ' +
                 this.myInstance.instanceId);
      }, (e) => {
        this.myInstance = new Core.LocalInstance(this, userId);
        this.log('generating new local instance: ' +
                 this.myInstance.instanceId);
        return storage.save<Instance>(key, this.myInstance.currentState());
      });
    }

    //===================== Social.Network implementation ====================//

    /**
     * Adds a new user to the roster.  Promise will be rejected if the user is
     * already in the roster.
     */
    protected addUser_ = (userId :string) : Core.User => {
      if (!this.isNewFriend_(userId)) {
        this.error(this.name + ': cannot add already existing user!');
      }
      this.log('added "' + userId + '" to roster.');
      var newUser = new Core.User(this, userId);
      this.roster[userId] = newUser;
      return newUser;
    }

    /**
     * Returns a User object for userId.  If the userId is not found in the
     * roster, a new User object will be created - in that case the User may
     * be missing fields like .name if it is not found in storage.
     */
    protected getOrAddUser_ = (userId :string) : Core.User => {
      if (this.isNewFriend_(userId)) {
        return this.addUser_(userId);
      }
      return this.getUser(userId);
    }

    /**
     * Helper to determine if |userId| is a "new friend" to be added to the
     * roster, and also isn't just our own userId, since we can receive XMPP
     * messages for ourself too.
     */
    protected isNewFriend_ = (userId :string) : boolean => {
      return !(this.myInstance && this.myInstance.userId == userId) &&
             !(userId in this.roster);
    }

    public getLocalInstance = () : Core.LocalInstance => {
      return this.myInstance;
    }

    public getUser = (userId :string) : Core.User => {
      return this.roster[userId];
    }

    /**
     * Intended to be protected, but TypeScript has no 'protected' modifier.
     */
    public log = (msg :string) : void => {
      console.log('[' + this.name + '] ' + msg);
    }

    /**
     * Intended to be protected, but TypeScript has no 'protected' modifier.
     */
    public error = (msg :string) : void => {
      console.error('!!! [' + this.name + '] ' + msg);
    }

    public resendInstanceHandshakes = () : void => {
      // Do nothing for non-freedom networks (e.g. manual).
    }

    //================ Subclasses must override these methods ================//

    // From Social.Network:
    public login = (remember :boolean) : Promise<void> => {
      throw new Error('Operation not implemented');
    }
    public logout = () : Promise<void> => {
      throw new Error('Operation not implemented');
    }
    public flushQueuedInstanceMessages = () : void => {
      throw new Error('Operation not implemented');
    }
    public send = (user :Core.User,
                   recipientClientId :string,
                   message :uProxy.Message) : Promise<void> => {
      throw new Error('Operation not implemented');
    }

  }  // class AbstractNetwork


  // A Social.Network implementation that deals with a Freedom social provider.
  //
  // Handles events from the social provider. 'onUserProfile' events directly
  // affect the roster of this network, while 'onClientState' and 'onMessage'
  // events are passed on to the relevant user (provided the user exists).
  export class FreedomNetwork extends AbstractNetwork {

    private freedomApi_ :freedom_Social;
    // TODO: give real typing to provider_. Ask Freedom not to use overloaded
    // types.
    private provider_ :any;  // Special freedom object which is both a function
                             // and object... cannot typescript.

    // Promise that delays all message handling until fully logged in.
    private onceLoggedIn_   :Promise<void>;
    private remember :boolean;

    // ID returned by setInterval call for monitoring.
    private monitorIntervalId_ :number = null;

    private fulfillLogout_ : () => void;
    private onceLoggedOut_ : Promise<void>;

    /**
     * Initializes the Freedom social provider for this FreedomNetwork and
     * attaches event handlers.
     */
    constructor(public name :string) {
      super(name);

      this.provider_ = freedom[PREFIX + name];
      this.remember = false;
      this.onceLoggedIn_ = null;
      this.freedomApi_ = this.provider_();

      // TODO: Update these event name-strings when freedom updates to
      // typescript and Enums.
      this.freedomApi_.on('onUserProfile',
                          this.delayForLogin_(this.handleUserProfile));
      this.freedomApi_.on('onClientState',
                          this.delayForLogin_(this.handleClientState));
      this.freedomApi_.on('onMessage',
                          this.delayForLogin_(this.handleMessage));
    }

    /**
     * Functor that delays until the network is logged in.
     * Resulting function will instantly fail if not already in the process of
     * logging in.
     * TODO: This should either be factored into a wrapper class to 'sanitize'
     * social providers' async behavior, or directly into freedom.
     */
    private delayForLogin_ = (handler :Function) => {
      return (arg :any) => {
        if (!this.onceLoggedIn_) {
          this.error('Not logged in.');
          return;
        }
        return this.onceLoggedIn_.then(() => {
          handler(arg);
        });
      }
    }

    /**
     * Handler for receiving 'onUserProfile' messages. First, determines whether
     * the UserProfile belongs to ourselves or a remote contact. Then,
     * updates / adds the user data to the roster.
     *
     * NOTE: Our own 'Instance Handshake' is specific to this particular
     * network, and can only be prepared after receiving our own vcard for the
     * first time.
     * TODO: Check if the above statement on vcard is actually true.
     *
     * Public to permit testing.
     */
    public handleUserProfile = (profile :freedom_Social.UserProfile) : void => {
      var userId = profile.userId;
      if (!Firewall.isValidUserProfile(profile, null)) {
        this.error("Firewall: invalid user profile: " + JSON.stringify(profile));
        return;
      }
      // Check if this is ourself, in which case we update our own info.
      if (userId == this.myInstance.userId) {
        // TODO: we may want to verify that our status is ONLINE before
        // sending out any instance messages.
        this.log('<-- XMPP(self) [' + profile.name + ']\n' + profile);

        // Update UI with own information.
        var userProfileMessage :UI.UserProfileMessage = {
          userId: profile.userId,
          name: profile.name,
          imageData: profile.imageData
        };
        ui.update(uProxy.Update.USER_SELF, <UI.UserMessage>{
          network: this.name,
          user:    userProfileMessage
        });

        return;
      }
      // Otherwise, this is a remote contact. Add them to the roster if
      // necessary, and update their profile.
      this.log('<--- XMPP(friend) [' + profile.name + ']' + profile);
      this.getOrAddUser_(userId).update(profile);
    }

    /**
     * Handler for receiving 'onClientState' messages. Passes these messages to
     * the relevant user, which will manage its own clients.
     *
     * It is possible that the roster entry does not yet exist for a user,
     * yet we receive a client state from them. In this case, create a
     * place-holder user until we receive more user information.
     *
     * Assumes we are in fact fully logged in.
     *
     * Public to permit testing.
     */
    public handleClientState = (freedomClient :freedom_Social.ClientState) : void => {
      if (!Firewall.isValidClientState(freedomClient, null)) {
        this.error("Firewall: invalid client state: " + JSON.stringify(freedomClient));
        return;
      }
      var client :UProxyClient.State =
        freedomClientToUproxyClient(freedomClient);
      if (client.status === UProxyClient.Status.ONLINE_WITH_OTHER_APP) {
        // Ignore clients that aren't using uProxy.
        return;
      }

      if (client.userId == this.myInstance.userId) {
        // Log out if it's our own client id.
        // TODO: Consider adding myself to the roster.
        if (client.clientId === this.myInstance.clientId &&
            client.status === UProxyClient.Status.OFFLINE) {
          this.fulfillLogout_();
        }
        this.log('received own ClientState: ' + JSON.stringify(client));
        return;
      }

      this.getOrAddUser_(client.userId).handleClient(client);
    }

    /**
     * When receiving a message from a social provider, delegate it to the
     * correct user, which will delegate to the correct client.
     *
     * It is possible that the roster entry does not yet exist for a user,
     * yet we receive a message from them. In this case, create a place-holder
     * user until we receive more user information.
     *
     * Public to permit testing.
     */
    public handleMessage = (incoming :freedom_Social.IncomingMessage) : void => {
      if (!Firewall.isValidIncomingMessage(incoming, null)) {
        this.error("Firewall: invalid incoming message: " + JSON.stringify(incoming));
        return;
      }
      var userId = incoming.from.userId;
      var msg :uProxy.Message = JSON.parse(incoming.message);

      var client :UProxyClient.State =
          freedomClientToUproxyClient(incoming.from);
      if (client.status === UProxyClient.Status.ONLINE_WITH_OTHER_APP) {
        // Ignore clients that aren't using uProxy.
        return;
      }

      var user = this.getOrAddUser_(userId);
      if (!user.clientIdToStatusMap[client.clientId]) {
        // Add client.
        user.handleClient(client);
      }

      console.log(
          'received message from userId: ' + user.userId +
          ', clientId: ' + client.clientId +
          // Instance may be undefined if we have not yet created an instance
          // for this client, e.g. if this is the first instance message we
          // are receiving from them.  This is not an error.
          ', instanceId: ' + user.clientToInstance(client.clientId) +
          ', message: ' + JSON.stringify(msg));
      user.handleMessage(client.clientId, msg);
    }

    public restoreFromStorage() {
      // xmpp is weird, so we need to do this.
      return storage.keys().then((keys :string[]) => {
        var myKey = this.getStorePath();
        for (var i in keys) {
          if (keys[i].indexOf(myKey) === 0) {
            var userId = keys[i].substr(myKey.length);
            if (this.isNewFriend_(userId)) {
              this.addUser_(userId);
            }
          }
        }
      });
    }

    //===================== Social.Network implementation ====================//

    public login = (remember :boolean) : Promise<void> => {
      var request :freedom_Social.LoginRequest = {
        agent: 'uproxy',
        version: '0.1',
        url: 'https://github.com/uProxy/uProxy',
        interactive: true,
        rememberLogin: remember
      };
      this.onceLoggedIn_ = this.freedomApi_.login(request)
          .then((freedomClient :freedom_Social.ClientState) => {
            // Upon successful login, save local client information.
            this.startMonitor_();
            this.log('logged into uProxy');
            return this.prepareLocalInstance(freedomClient.userId).then(() => {
              this.myInstance.clientId = freedomClient.clientId;
              // Notify UI that this network is online before we fulfill
              // the onceLoggedIn_ promise.  This ensures that the UI knows
              // that the network is online before we send user updates.
              var payload :UI.NetworkMessage = {
                name: this.name,
                online: true,
                userId: freedomClient.userId
              };
              ui.update(uProxy.Update.NETWORK, payload);
            });
          });
      return this.onceLoggedIn_
          .then(() => {
            ui.showNotification('You successfully signed on to ' + this.name +
                                ' as ' + this.myInstance.userId);
            this.onceLoggedOut_ = new Promise((F, R) => {
              this.fulfillLogout_ = F;
            }).then(() => {
              this.stopMonitor_();
              for (var userId in this.roster) {
                this.roster[userId].handleLogout();
              }
              ui.showNotification('You have been logged out of ' + this.name);
              Social.removeNetwork(this.name, this.myInstance.userId);
              console.log('Fulfilling onceLoggedOut_');
            }).catch((e) => {
              console.error('Error fulfilling onceLoggedOut_', e);
            });
            this.restoreFromStorage();
          })
          .catch((e) => {
            this.error('Could not login.');
            ui.sendError('There was a problem signing in to ' + this.name +
                         '. Please try again. ');
            return Promise.reject(new Error('Could not login.'));
          });
    }

    public logout = () : Promise<void> => {
      return this.freedomApi_.logout().then(() => {
        this.fulfillLogout_();
      }).catch((e) => {
        console.error('error in this.freedomApi_.logout', e);
        return Promise.reject(e);
      });
    }

    /**
     * Promise the sending of |msg| to a client with id |clientId|.
     */
    public send = (user :Core.User,
                   clientId :string,
                   message :uProxy.Message) : Promise<void> => {
      var messageString = JSON.stringify(message);
      console.log(
          'sending message to userId: ' + user.userId +
          ', clientId: ' + clientId +
          // Instance may be undefined if we are making an instance request,
          // i.e. we know that a client is ONLINE with uProxy, but don't
          // yet have their instance info.  This is not an error.
          ', instanceId: ' + user.clientToInstance(clientId) +
          ', message: ' + messageString);
      return this.freedomApi_.sendMessage(clientId, messageString);
    }

    // TODO: We should make a class for monitors or generally to encapsulate
    // setInterval/clearInterval calls.  Then we could call monitor.start
    // and monitor.stop.
    private startMonitor_ = () : void => {
      if (this.monitorIntervalId_) {
        // clear any existing monitor
        console.error('startMonitor_ called with monitor already running');
        this.stopMonitor_();
      } else if (this.name == 'Facebook') {
        // Don't monitor (send INSTANCE_REQUEST messages) for Facebook,
        // to minimize spam.
        return;
      }

      var monitorCallback = () => {
        this.log('Running monitor');
        // TODO: if too many instances are missing, we may send more messages
        // than our XMPP server will allow and be throttled.  We should change
        // monitoring to limit the number of XMPP messages it sends on each
        // interval.
        for (var userId in this.roster) {
          this.getUser(userId).monitor();
        }
      };
      this.monitorIntervalId_ = setInterval(monitorCallback, 5000);
    }

    private stopMonitor_ = () : void => {
      if (this.monitorIntervalId_) {
        clearInterval(this.monitorIntervalId_);
      }
      this.monitorIntervalId_ = null;
    }

    public resendInstanceHandshakes = () : void => {
      for (var userId in this.roster) {
        this.roster[userId].resendInstanceHandshakes();
      }
    }

  }  // class Social.FreedomNetwork


  // A Social.Network implementation that "sends" a message by relaying it to
  // the uProxy UI for display to the user and "receives" a message from the
  // uProxy UI after the user has manually entered (copy/pasted) it into the
  // UI.
  //
  // This network is unusual in that there is no distinction among user IDs,
  // client IDs, and instance IDs; they are all the same thing. The reason is
  // as follows:
  //   - The manual network has no concept of a single user having multiple
  //     clients; the client ID uniquely identifies the user in the manual
  //     network. Thus, a user ID is also a client ID.
  //   - Similarly, there is no concept of a single user having multiple
  //     instances. Each instance is independent and not correlated with other
  //     instances in any way. Thus, an instance ID is also a user ID.
  export class ManualNetwork extends AbstractNetwork {
    constructor(public name :string) {
      super(name);
    }

    //===================== Social.Network implementation ====================//

    public login = (remember :boolean) : Promise<void> => {
      return Promise.resolve<void>();
    }

    public logout = () : Promise<void> => {
      return Promise.resolve<void>();
    }

    public send = (user :Core.User,
                   recipientClientId :string,
                   message :uProxy.Message) : Promise<void> => {
      this.log('Manual network sending message; recipientClientId=[' +
               recipientClientId + '], message=' + JSON.stringify(message));
      // TODO: Batch messages.

      // Relay the message to the UI for display to the user.
      ui.update(uProxy.Update.MANUAL_NETWORK_OUTBOUND_MESSAGE, message);

      return Promise.resolve<void>();
    }

    // TODO: Consider adding a mechanism for reporting back to the UI that a
    // message is malformed or otherwise invalid.
    public receive = (senderClientId :string,
                      message :uProxy.Message) : void => {
      this.log('Manual network received incoming message; senderClientId=[' +
               senderClientId + '], message=' + JSON.stringify(message));

      // Client ID and user ID are the same thing in the manual network, so the
      // sender client ID doubles as the sender user ID.
      var senderUserId = senderClientId;

      var user =this.getOrAddUser_(senderUserId);
      // Hack so that handleMessage treats this client as online and doesn't
      // reject.
      // TODO: refactor manual network to have its own client messages.
      user.clientIdToStatusMap[senderClientId] = UProxyClient.Status.ONLINE;
      user.handleMessage(senderUserId, message);
    }

  }  // class ManualNetwork

}  // module Social

function freedomClientToUproxyClient(
  freedomClientState :freedom_Social.ClientState) : UProxyClient.State {
  // Convert status from Freedom style enum value ({'ONLINE': 'ONLINE',
  // 'OFFLINE: 'OFFLINE'}) to TypeScript style {'ONLINE': 4000, 4000: 'ONLINE',
  // 'OFFLINE': 4001, 4001: 'OFFLINE'} value.
  return {
    userId:    freedomClientState.userId,
    clientId:  freedomClientState.clientId,
    status:    UProxyClient.Status[freedomClientState.status],
    timestamp: freedomClientState.timestamp
  };
}
