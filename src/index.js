import store from 'store';
import fetchWithRetries from 'fbjs/lib/fetchWithRetries';
import WinChan from 'winchan';
import ExecutionEnvironment from 'fbjs/lib/ExecutionEnvironment';
import { EventEmitter } from 'fbemitter';

const ACCESS_TOKEN = 'MELDIO_ACCESS_TOKEN';
const PROVIDER_FEATURES = {
  facebook: 'width=500,height=620',
  google: 'width=460,height=620',
  github: 'width=1000,height=620',
};
const SUPPORTED_PROVIDERS = Object.keys(PROVIDER_FEATURES)
  .map(key => `"${key}"`)
  .join(', ');
const DEFAULT_RETRY_SPEC = {
  fetchTimeout: 5000, /* ms */
  retryDelays: [ 1000, 3000, 5000 ], /* ms */
};

function invariant(condition, code, message) {
  if (!Boolean(condition)) {
    const error = new Error(message);
    error.code = code;
    throw error;
  }
}

/**
 * Meldio class allows client applications to authenticate with the Meldio
 * server, configure instances of Relay framework to work with the Meldio server
 * and execute GraphQL queries and mutations.
 * @example
 * // without Relay:
 * import Meldio from 'meldio-client';
 * const meldio = new Meldio('http://localhost:9000');
 * export default meldio;
 * @example
 * // with Relay:
 * import Meldio from 'meldio-client';
 * import Relay from 'react-relay';
 * const meldio = new Meldio('http://localhost:9000');
 * meldio.injectNetworkLayerInto(Relay);
 * export default meldio;
 */
export default class Meldio extends EventEmitter {
  /**
   * Creates a new Meldio client object.
   * @param {string} url -
   *   root url of the Meldio server, e.g. http://localhost:9000
   * @param {Object} [options={}] - configuration options
   * @param {string} [options.authUrl] -
   *   Authentication server url, if different than the Meldio server url
   * @param {string} [options.accessToken] -
   *   Used to initialize Meldio client with an existing access token
   * @param {boolean|Object} [options.retry] -
   *   If the parameter is true, Meldio client will be
   *   initialized with the default timeout (5000 ms) and retry delays
   *   (1000, 3000 and 5000 ms).
   *   If the value is an object, Meldio client will be
   *   initialized with the provided fetchTimeout and relayDelays array if they
   *   are provided or with the default values if they are not provided.
   *   Otherwise, Meldio client will be initialized with the default fetch
   *   timeout of 5000 ms and no retries.
   */
  constructor(url, options = { }) {
    super();
    this._url = url;
    this._authUrl = options.authUrl || this._url;
    this._accessToken = options.accessToken || (
      store.enabled && store.get(ACCESS_TOKEN) ?
        store.get(ACCESS_TOKEN) :
        null );
    this._retrySpec =
      options.retry === true ?
        DEFAULT_RETRY_SPEC :
      typeof options.retry === 'object' ?
        {
          fetchTimeout: options.retry.fetchTimeout ||
                        DEFAULT_RETRY_SPEC.fetchTimeout,
          retryDelays: options.retry.retryDelays ||
                       DEFAULT_RETRY_SPEC.retryDelays,
        } :
        {
          fetchTimeout: DEFAULT_RETRY_SPEC.fetchTimeout,
          retryDelays: [ ],
        };
    this._networkLayer = null;
  }

  _setAccessToken(accessToken) {
    this._accessToken = accessToken;
    if (store.enabled) {
      if (accessToken) {
        store.set(ACCESS_TOKEN, accessToken);
      } else {
        store.remove(ACCESS_TOKEN);
      }
    }
    if (this._networkLayer) {
      this._networkLayer._init.headers = accessToken ?
        { Authorization: `Bearer ${accessToken}` } :
        { };
    }
  }

  _clearAccessToken() {
    this._accessToken = null;
    if (store.enabled) {
      store.remove(ACCESS_TOKEN);
    }
    if (this._networkLayer) {
      this._networkLayer._init.headers = { };
    }
  }

  /**
   * Checks if the access token is set and returns true if it is and false
   * otherwise.
   * @returns {Boolean} true if access token is set, false otherwise
   */
  isLoggedIn() {
    return Boolean(this._accessToken);
  }

  /**
   * Initiates OAuth popup authentication flow with the specified provider. This
   * method is limited to the browser environment.  For all other use cases
   * (e.g. server or mobile) use loginWithAccessToken instead.
   * @param {string} provider -
   *   Provider to authenticate with. Can be either 'facebook',
   *   'google' or 'github'.
   * @return {Promise<string, Error>} Resolves to Meldio access token string if
   *   authentication is successful. Resolves to Error if method is invoked
   *   from outside the browser environment, provider parameter is not valid or
   *   if authentication has failed.
   * @emits Meldio#login
   */
  async loginWithOAuthPopup(provider) {
    invariant(ExecutionEnvironment.canUseDOM,
      `BROWSER_ONLY`,
      `Meldio.loginWithOAuthPopup can only be invoked from the browser.`);
    invariant(PROVIDER_FEATURES[provider],
      `UNSUPPORTED_PROVIDER`,
      `Provider passed to Meldio.loginWithOAuthPopup must be one of: ` +
        SUPPORTED_PROVIDERS);

    const url = `${this._authUrl}/auth/${provider}`;
    const relayUrl = `${this._authUrl}/auth/relay`;
    const windowFeatures = PROVIDER_FEATURES[provider];

    return new Promise( (resolve, reject) => {
      WinChan.open({
        url,
        'relay_url': relayUrl,              // eslint-disable-line quote-props
        'window_features': windowFeatures,  // eslint-disable-line quote-props
      }, (error, response) => {
        if (error) {
          reject({ code: 'NOAUTH', message: error });
        } else if (response.error) {
          reject(response.error);
        } else {
          this._setAccessToken(response.accessToken);
          this.emit('login', response.accessToken);
          resolve(response.accessToken);
        }
      });
    });
  }

  /**
   * Initiates OAuth authentication process with the specified provider using
   * an access token issued by that provider.
   * @param {string} provider -
   *   Provider to authenticate with. Can be either 'facebook',
   *   'google' or 'github'.
   * @param {string} accessToken -
   *   Access token previousely issued by the specified authentication provider.
   * @return {Promise<string, Error>} Resolves to Meldio access token string if
   *   authentication is successful. Resolves to Error if authentication has
   *   failed.
   * @emits Meldio#login
   */
  async loginWithAccessToken(provider, accessToken) {
    invariant(PROVIDER_FEATURES[provider],
      `UNSUPPORTED_PROVIDER`,
      `Provider passed to Meldio.loginWithAccessToken must be one of: ` +
        SUPPORTED_PROVIDERS);

    const url = `${this._authUrl}/auth/${provider}`;
    const init = {
      method: 'POST',
      body: JSON.stringify({
        'access_token': accessToken  // eslint-disable-line quote-props
      }),
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      ...this._retrySpec,
    };
    const response = await fetchWithRetries(url, init);
    const content = await response.json();

    if (content && content.error) {
      const error = new Error(content.error.message);
      error.code = content.error.code;
      throw error;
    } else if (!content || !content.accessToken) {
      const error = new Error('Authentication failed. Missing access token.');
      error.code = 'NO_ACCESS_TOKEN';
      throw error;
    }

    this._setAccessToken(content.accessToken);
    this.emit('login', content.accessToken);
    return content.accessToken;
  }

  /**
   * Authenticates with the Meldio server using a loginId and password.
   * @param {string} loginId -
   *   Application-specific loginId (e.g. email, phone number, user handle).
   * @param {string} password -
   *   Password assigned to the user.
   * @return {Promise<string, Error>} Resolves to Meldio access token string if
   *   authentication is successful. Resolves to Error if authentication has
   *   failed.
   * @emits Meldio#login
   */
  async loginWithPassword(loginId, password) {
    invariant(loginId && typeof loginId === 'string',
      `LOGIN_REQUIRED`,
      `loginId string must be passed to Meldio.loginWithPassword`);
    invariant(password && typeof password === 'string',
      `PASSWORD_REQUIRED`,
      `password string must be passed to Meldio.loginWithPassword`);

    const url = `${this._authUrl}/auth/password`;
    const init = {
      method: 'POST',
      body: JSON.stringify({ loginId, password }),
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      ...this._retrySpec,
    };
    const response = await fetchWithRetries(url, init);
    const content = await response.json();

    if (content && content.error) {
      const error = new Error(content.error.message);
      error.code = content.error.code;
      throw error;
    } else if (!content || !content.accessToken) {
      const error = new Error('Authentication failed. Missing access token.');
      error.code = 'NO_ACCESS_TOKEN';
      throw error;
    }

    this._setAccessToken(content.accessToken);
    this.emit('login', content.accessToken);
    return content.accessToken;
  }

  /**
   * Terminates the authenticated session with the Meldio server and clears
   * the access token.
   * @return {Promise<void, Error>} Resolves to Error if logout has failed.
   * @emits Meldio#logout
   */
  async logout() {
    if (this.isLoggedIn()) {
      const url = `${this._authUrl}/auth/logout`;
      const init = {
        method: 'POST',
        body: JSON.stringify({
          'access_token': this._accessToken  // eslint-disable-line quote-props
        }),
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        ...this._retrySpec,
      };
      const response = await fetchWithRetries(url, init);
      const content = await response.json();

      if (content && content.error) {
        console.error(`${content.error.code}: ${content.error.message}`);
      }

      this._clearAccessToken();
      this.emit('logout');
    }
  }

  /**
  * Executes a GraphQL query or mutation.  Query can be provided as string or
  * an object with "query" and "variables" properties.
  * @param {string|Object} params -
  *   String that contains GraphQL query or an object with "query" and
  *   "variables" properties
  * @param {string} params.query - Query string containing GraphQL query or
  *   mutation
  * @param {string|Object} params.variables - Object or JSON string
  *   representation of variable names and values referenced in the query
  * @return {Promise<Object, Error>} Resolves to an object with result set if
  *   operation is successful. Resolves to Error if operation has failed.
  */
  async graphql(params) {
    invariant(
       typeof params === 'string' ||
       typeof params === 'object' &&
       typeof params.query === 'string' &&
       ( !params.variables ||
          typeof params.variables === 'object' ||
          typeof params.variables === 'string'),
      `INVALID_PARAMS`,
      `graphql expects a string or object with query and variables.`);
    const url = `${this._url}/graphql`;
    const body = typeof params === 'string' ?
      JSON.stringify({ query: params }) :
      JSON.stringify(params);
    const init = {
      method: 'POST',
      body,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...this._accessToken ?
          { Authorization: `Bearer ${this._accessToken}`, } :
          { },
      },
      ...this._retrySpec,
    };

    let response;
    try {
      response = await fetchWithRetries(url, init);
    } catch (e) {
      if (e.response) {
        response = e.response;
      } else {
        throw e;
      }
    }

    const content = await response.json();

    if (content && content.errors && content.errors.length &&
        content.errors[0].code === 'INVALID_TOKEN') {
      content.errors.forEach(err =>
        console.error(`${err.code || 'ERROR'}: ${err.message}`));
      this._clearAccessToken();
      this.emit('logout');
    }

    return content;
  }

  /**
   * Configures an instance of Relay framework to work with Meldio.
   * @param {Relay} Relay - Relay framework instance
   * @example
   * import Meldio from 'meldio-client';
   * import Relay from 'react-relay';
   * const meldio = new Meldio('http://localhost:9000');
   * meldio.injectNetworkLayerInto(Relay);
   */
  injectNetworkLayerInto(Relay) {
    this._networkLayer = new Relay.DefaultNetworkLayer(`${this._url}/graphql`, {
      headers: this._accessToken ?
        { Authorization: `Bearer ${this._accessToken}`, } :
        { },
    });
    Relay.injectNetworkLayer(this._networkLayer);
  }
}
