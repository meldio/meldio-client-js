# Meldio JavaScript Driver [![Build Status](https://travis-ci.org/meldio/meldio-client-js.svg?branch=master)](https://travis-ci.org/meldio/meldio-client-js)

Meldio is an open source GraphQL backend for building delightful mobile and web
apps.

This library allows JavaScript applications to connect to Meldo,
start authentication flow and execute GraphQL queries and mutations.

Need help?
  * [Join our Slack channel](https://meldio-slack.herokuapp.com)
  * [Ask a question on Stack Overflow](https://stackoverflow.com/questions/ask?tags=meldio)

## Installation and Setup

See [our start building guide](https://www.meldio.com/start-building) for
detailed instructions on how to install Meldio.

#### Installation from NPM

To install Meldio Client Driver, run the following from your app project
directory:

```bash
npm install meldio-client
```

#### Installation from Source

You can also install Meldio JavaScript client driver from source using the
following steps:

```bash
git clone https://github.com/meldio/meldio-client-js.git
cd meldio-client-js
npm install
npm run build
```

Then reference the local meldio-client-js build from your project package.json,
like this:

```json
"dependencies": {
  "meldio-client": "file:../meldio-client-js/",
}
```

#### Include with HTML Script tag
Meldio client is hosted on JSDelivr CDN, so you can also include it with:
```html
<script src="https://cdn.jsdelivr.net/meldio.client.js/0.4.10/meldio.min.js"></script>
```


## Usage
#### Importing the module

Import the Meldio client module as follows:
```javascript
import Meldio from 'meldio-client';  
```
Alternatively, you may use `require`:
```javascript
const Meldio = require('meldio-client');
```


#### Constructor
When using Meldio together with the Relay framework, create a new
instance of the Meldio client and inject Meldio network layer into Relay:
```javascript
// with Relay:
import Meldio from 'meldio-client';
import Relay from 'react-relay';
const meldio = new Meldio('http://localhost:9000');
meldio.injectNetworkLayerInto(Relay);
```

When Meldio server is accessed directly, just create a new instance of the
Meldio client:
```javascript
// without Relay:
import Meldio from 'meldio-client';
const meldio = new Meldio('http://localhost:9000');
```

You may then export Meldio instance with:
```javascript
export default meldio;
```

See [Todo app](https://github.com/meldio/todoapp/blob/master/web/meldio.js) for
an example of setting up Meldio to work with Relay.


#### Events
Meldio class inherits from [EventEmitter](https://github.com/facebook/emitter) to
allow users to subscribe to `login` and `logout` events like this:

```javascript
// loginHandler function may take Meldio access token as a parameter
const loginListener = meldio.addListener('login', loginHandler);
const logoutListener = meldio.addListener('logout', logoutHandler);
```

To unsubscribe, simply use the `remove` method on the listener reference:
```javascript
loginListener.remove();
logoutListener.remove();
```


#### OAuth Authentication
If the app is running within the browser environment, you may start
authentication with the Meldio server using the OAuth provider popup with:
```javascript
meldio.loginWithOAuthPopup('facebook')  // or 'google' or 'github'
  .then(accessToken => /* promise resolves with Meldio accessToken */)
  .catch(error => console.error('Login failed: ', error.code, error.message));
```

Alternatively, you may initiate authentication with the Meldio server using
an access token obtained directly from the OAuth provider
(e.g. using Facebook or Google client library). The following code exchanges
Facebook access token stored in `fbToken` variable for a Meldio access token:
```javascript
meldio.loginWithAccessToken('facebook', fbToken)
  .then(accessToken => /* promise resolves with Meldio accessToken */)
  .catch(error => console.error('Login failed: ', error.code, error.message));
```

Both `loginWithOAuthPopup` and `loginWithAccessToken` methods emit a `login`
event upon successful login.

See Todo app's [Login](https://github.com/meldio/todoapp/blob/master/web/components/Login.js)
and [AppContainer](https://github.com/meldio/todoapp/blob/master/web/components/AppContainer.js) controls for a complete example of how to combine OAuth popup flow with authentication
events.

#### Password Authentication

When password authentication is enabled and setup on the Meldio server, you may
authenticate users with a loginId (e.g. email, phone number or user handle) and
password using the `loginWithPassword` method:

```javascript
loginWithPassword(loginId, password)
  .then(accessToken => /* promise resolves with Meldio accessToken */)
  .catch(error => {
    if (error.code === 'INVALID_LOGINID') {
      console.log('loginId is invalid');
    } else if (error.code === 'INVALID_PASSWORD') {
      console.log('password is invalid')
    } else if  (error.code === 'LOGIN_REFUSED') {
      console.log('Login Refused: ', error.message)
    } else {
      // misc. errors
      console.log(error.code, error.message)
    }
  });

```

Note that `loginWithPassword` method emits a `login` event upon successful
login.

#### Authentication Status
Check authentication status using the `isLoggedIn` method which returns `true`
if user is logged in and `false` otherwise:

```javascript
if (meldio.isLoggedIn()) {
  console.log('User is logged in');
} else {
  console.log('User is not logged in');
}
```

#### Running Queries
Running GraphQL queries is very simple with the `graphql` method:

```javascript
meldio.graphql(`{
  viewer {
    id
    firstName
    lastName
    emails
    profilePictureUrl
    todos {
      numberOfAllTodos: count(filter: ALL)
      numberOfCompletedTodos: count(filter: COMPLETED)
      edges {
        node {
          id
          text
          complete
        }
      }
    }
  }
}`)
  .then(result => /* handle the results returned by the query */ )
  .catch(error => /* handle errors */ )
```

To execute a query or mutation with parameters, pass an object with `query`
string and `variables` object like this:

```javascript
meldio.graphql({
  query: `
    query QueryWithParams($complete: Boolean){
      viewer {
        todos(filter: STATUS complete: $complete) {
          edges {
            node {
              id
              text
              complete
            }
          }
        }
      }
    }`,
  variables: {
    complete: true
  }
})
  .then(result => /* handle the results returned by the query */ )
  .catch(error => /* handle errors */ )
```


#### Logging out
Logout a user from the Meldio server using the `logout` method as follows:

```javascript
meldio.logout()
  .then( () => /* logout handler */ )
  .catch( error => console.log(error.code, error.message) );
```

Note that `logout` method emits a `logout` event upon successful logout.


## Next Steps

Check out [our start building guide](https://www.meldio.com/start-building) or
get started with [some cool examples](https://www.meldio.com/examples).

## License

This code is free software, licensed under the MIT license. See the `LICENSE`
file for more details.
