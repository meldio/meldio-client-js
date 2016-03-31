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

class Meldio extends EventEmitter {
  constructor(url, options = { }) {
    super();
    this.url = url;
    this.authUrl = options.authUrl || this.url;
    this.accessToken = options.accessToken || (
      store.enabled && store.get(ACCESS_TOKEN) ?
        store.get(ACCESS_TOKEN) :
        null );
    this.retrySpec =
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
    this.networkLayer = null;
  }

  setAccessToken(accessToken) {
    this.accessToken = accessToken;
    if (store.enabled) {
      if (accessToken) {
        store.set(ACCESS_TOKEN, accessToken);
      } else {
        store.remove(ACCESS_TOKEN);
      }
    }
    if (this.networkLayer) {
      this.networkLayer._init.headers = accessToken ?
        { Authorization: `Bearer ${accessToken}` } :
        { };
    }
  }

  clearAccessToken() {
    this.accessToken = null;
    if (store.enabled) {
      store.remove(ACCESS_TOKEN);
    }
    if (this.networkLayer) {
      this.networkLayer._init.headers = { };
    }
  }

  isLoggedIn() {
    return Boolean(this.accessToken);
  }

  async loginWithOAuthPopup(provider) {
    invariant(ExecutionEnvironment.canUseDOM,
      `BROWSER_ONLY`,
      `Meldio.loginWithOAuthPopup can only be invoked from the browser.`);
    invariant(PROVIDER_FEATURES[provider],
      `UNSUPPORTED_PROVIDER`,
      `Provider passed to Meldio.loginWithOAuthPopup must be one of: ` +
        SUPPORTED_PROVIDERS);

    const url = `${this.authUrl}/auth/${provider}`;
    const relayUrl = `${this.authUrl}/auth/relay`;
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
          this.setAccessToken(response.accessToken);
          this.emit('login', response.accessToken);
          resolve(response.accessToken);
        }
      });
    });
  }

  async loginWithAccessToken(provider, accessToken) {
    invariant(PROVIDER_FEATURES[provider],
      `UNSUPPORTED_PROVIDER`,
      `Provider passed to Meldio.loginWithAccessToken must be one of: ` +
        SUPPORTED_PROVIDERS);

    const url = `${this.authUrl}/auth/${provider}`;
    const init = {
      method: 'POST',
      body: JSON.stringify({
        'access_token': accessToken  // eslint-disable-line quote-props
      }),
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      ...this.retrySpec,
    };
    const response = await fetchWithRetries(url, init);
    const content = await response.json();

    if (content && content.accessToken) {
      this.setAccessToken(content.accessToken);
      this.emit('login', content.accessToken);
      return content.accessToken;
    }

    if (content && content.error) {
      const error = new Error(content.error.message);
      error.code = content.error.code;
      throw error;
    }

    throw new Error('Authentication failed.');
  }

  async loginWithPassword(loginId, password) {
    invariant(loginId && typeof loginId === 'string',
      `LOGIN_REQUIRED`,
      `loginId string must be passed to Meldio.loginWithPassword`);
    invariant(password && typeof password === 'string',
      `PASSWORD_REQUIRED`,
      `password string must be passed to Meldio.loginWithPassword`);

    const url = `${this.authUrl}/auth/password`;
    const init = {
      method: 'POST',
      body: JSON.stringify({ loginId, password }),
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      ...this.retrySpec,
    };
    const response = await fetchWithRetries(url, init);
    const content = await response.json();

    if (content && content.accessToken) {
      this.setAccessToken(content.accessToken);
      this.emit('login', content.accessToken);
      return content.accessToken;
    }

    if (content && content.error) {
      const error = new Error(content.error.message);
      error.code = content.error.code;
      throw error;
    }

    throw new Error('Authentication failed.');
  }

  async logout() {
    if (this.isLoggedIn()) {
      const url = `${this.authUrl}/auth/logout`;
      const init = {
        method: 'POST',
        body: JSON.stringify({
          'access_token': this.accessToken  // eslint-disable-line quote-props
        }),
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        ...this.retrySpec,
      };
      const response = await fetchWithRetries(url, init);
      const content = await response.json();

      if (content && content.error) {
        console.error(`${content.error.code}: ${content.error.message}`);
      }

      this.clearAccessToken();
      this.emit('logout');
      return;
    }
  }

  // params = string or { query, variables }
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
    const url = `${this.url}/graphql`;
    const body = typeof params === 'string' ?
      JSON.stringify({ query: params }) :
      JSON.stringify(params);
    const init = {
      method: 'POST',
      body,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...this.accessToken ?
          { Authorization: `Bearer ${this.accessToken}`, } :
          { },
      },
      ...this.retrySpec,
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
      this.clearAccessToken();
      this.emit('logout');
    }

    return content;
  }

  injectNetworkLayerInto(Relay) {
    this.networkLayer = new Relay.DefaultNetworkLayer(`${this.url}/graphql`, {
      headers: this.accessToken ?
        { Authorization: `Bearer ${this.accessToken}`, } :
        { },
    });
    Relay.injectNetworkLayer(this.networkLayer);
  }
}

module.exports = Meldio;
