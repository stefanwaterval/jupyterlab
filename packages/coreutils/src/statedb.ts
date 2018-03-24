// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import {
  ReadonlyJSONObject, ReadonlyJSONValue, Token
} from '@phosphor/coreutils';

import {
  ISignal, Signal
} from '@phosphor/signaling';

import {
  IDataConnector
} from './interfaces';


/* tslint:disable */
/**
 * The default state database token.
 */
export
const IStateDB = new Token<IStateDB>('@jupyterlab/coreutils:IStateDB');
/* tslint:enable */


/**
 * An object which holds an id/value pair.
 */
export
interface IStateItem {
  /**
   * The identifier key for a state item.
   */
  id: string;

  /**
   * The data value for a state item.
   */
  value: ReadonlyJSONValue;
}


/**
 * The description of a state database.
 */
export
interface IStateDB extends IDataConnector<ReadonlyJSONValue> {
  /**
   * The maximum allowed length of the data after it has been serialized.
   */
  readonly maxLength: number;

  /**
   * The namespace prefix for all state database entries.
   *
   * #### Notes
   * This value should be set at instantiation and will only be used
   * internally by a state database. That means, for example, that an
   * app could have multiple, mutually exclusive state databases.
   */
  readonly namespace: string;

  /**
   * Retrieve all the saved bundles for a namespace.
   *
   * @param namespace - The namespace to retrieve.
   *
   * @returns A promise that bears a collection data payloads for a namespace.
   *
   * #### Notes
   * Namespaces are entirely conventional entities. The `id` values of stored
   * items in the state database are formatted: `'namespace:identifier'`, which
   * is the same convention that command identifiers in JupyterLab use as well.
   *
   * If there are any errors in retrieving the data, they will be logged to the
   * console in order to optimistically return any extant data without failing.
   * This promise will always succeed.
   */
  fetchNamespace(namespace: string): Promise<IStateItem[]>;

  /**
   * Return a serialized copy of the state database's entire contents.
   *
   * @returns A promise that bears the database contents as JSON.
   */
  toJSON(): Promise<ReadonlyJSONObject>;
}


/**
 * The default concrete implementation of a state database.
 */
export
class StateDB implements IStateDB {
  /**
   * Create a new state database.
   *
   * @param options - The instantiation options for a state database.
   */
  constructor(options: StateDB.IOptions) {
    const { namespace, transform } = options;

    this.namespace = namespace;

    // Retrieve the window name, which is used as a namespace prefix.
    this._ready = Private.windowName().then(name => {
      this._window = name;

      if (!transform) {
        return;
      }

      return transform.then(transformation => {
        const { contents, type } = transformation;

        switch (type) {
          case 'cancel':
            return;
          case 'clear':
            this._clear();
            return;
          case 'merge':
            this._merge(contents || { });
            return;
          case 'overwrite':
            this._overwrite(contents || { });
            return;
          default:
            return;
        }
      });
    });
  }

  get changed(): ISignal<this, StateDB.Change> {
    return this._changed;
  }

  /**
   * The maximum allowed length of the data after it has been serialized.
   */
  readonly maxLength = 2000;

  /**
   * The namespace prefix for all state database entries.
   *
   * #### Notes
   * This value should be set at instantiation and will only be used internally
   * by a state database. That means, for example, that an app could have
   * multiple, mutually exclusive state databases.
   */
  readonly namespace: string;

  /**
   * Clear the entire database.
   */
  clear(silent = false): Promise<void> {
    return this._ready.then(() => {
      this._clear();

      if (silent) {
        return;
      }

      this._changed.emit({ id: null, type: 'clear' });
    });
  }

  /**
   * Retrieve a saved bundle from the database.
   *
   * @param id - The identifier used to retrieve a data bundle.
   *
   * @returns A promise that bears a data payload if available.
   *
   * #### Notes
   * The `id` values of stored items in the state database are formatted:
   * `'namespace:identifier'`, which is the same convention that command
   * identifiers in JupyterLab use as well. While this is not a technical
   * requirement for `fetch()`, `remove()`, and `save()`, it *is* necessary for
   * using the `fetchNamespace()` method.
   *
   * The promise returned by this method may be rejected if an error occurs in
   * retrieving the data. Non-existence of an `id` will succeed with `null`.
   */
  fetch(id: string): Promise<ReadonlyJSONValue | undefined> {
    return this._ready.then(() => this._fetch(id));
  }

  /**
   * Retrieve all the saved bundles for a namespace.
   *
   * @param namespace - The namespace to retrieve.
   *
   * @returns A promise that bears a collection data payloads for a namespace.
   *
   * #### Notes
   * Namespaces are entirely conventional entities. The `id` values of stored
   * items in the state database are formatted: `'namespace:identifier'`, which
   * is the same convention that command identifiers in JupyterLab use as well.
   *
   * If there are any errors in retrieving the data, they will be logged to the
   * console in order to optimistically return any extant data without failing.
   * This promise will always succeed.
   */
  fetchNamespace(namespace: string): Promise<IStateItem[]> {
    return this._ready.then(() => {
      const { localStorage } = window;
      const prefix = `${this._window}:${this.namespace}:${namespace}:`;
      let items: IStateItem[] = [];
      let i = localStorage.length;

      while (i) {
        let key = localStorage.key(--i);

        if (key && key.indexOf(prefix) === 0) {
          let value = localStorage.getItem(key);

          try {
            let envelope = JSON.parse(value) as Private.Envelope;

            items.push({
              id: key.replace(`${this._window}:${this.namespace}:`, ''),
              value: envelope ? envelope.v : undefined
            });
          } catch (error) {
            console.warn(error);
            localStorage.removeItem(key);
          }
        }
      }

      return items;
    });
  }

  /**
   * Remove a value from the database.
   *
   * @param id - The identifier for the data being removed.
   *
   * @returns A promise that is rejected if remove fails and succeeds otherwise.
   */
  remove(id: string): Promise<void> {
    return this._ready.then(() => {
      this._remove(id);
      this._changed.emit({ id, type: 'remove' });
    });
  }

  /**
   * Save a value in the database.
   *
   * @param id - The identifier for the data being saved.
   *
   * @param value - The data being saved.
   *
   * @returns A promise that is rejected if saving fails and succeeds otherwise.
   *
   * #### Notes
   * The `id` values of stored items in the state database are formatted:
   * `'namespace:identifier'`, which is the same convention that command
   * identifiers in JupyterLab use as well. While this is not a technical
   * requirement for `fetch()`, `remove()`, and `save()`, it *is* necessary for
   * using the `fetchNamespace()` method.
   */
  save(id: string, value: ReadonlyJSONValue): Promise<void> {
    return this._ready.then(() => {
      this._save(id, value);
      this._changed.emit({ id, type: 'save' });
    });
  }

  /**
   * Return a serialized copy of the state database's entire contents.
   *
   * @returns A promise that bears the database contents as JSON.
   */
  toJSON(): Promise<ReadonlyJSONObject> {
    return this._ready.then(() => {
      const { localStorage } = window;
      const prefix = `${this._window}:${this.namespace}:`;
      const contents: Partial<ReadonlyJSONObject> =  { };
      let i = localStorage.length;

      while (i) {
        let key = localStorage.key(--i);

        if (key && key.indexOf(prefix) === 0) {
          let value = localStorage.getItem(key);

          try {
            let envelope = JSON.parse(value) as Private.Envelope;

            if (envelope) {
              contents[key.replace(prefix, '')] = envelope.v;
            }
          } catch (error) {
            console.warn(error);
            localStorage.removeItem(key);
          }
        }
      }

      return contents;
    });
  }

  /**
   * Clear the entire database.
   *
   * #### Notes
   * Unlike the public `clear` method, this method is synchronous.
   */
  private _clear(): void {
    const { localStorage } = window;
    const prefix = `${this._window}:${this.namespace}:`;
    let i = localStorage.length;

    while (i) {
      let key = localStorage.key(--i);

      if (key && key.indexOf(prefix) === 0) {
        localStorage.removeItem(key);
      }
    }
  }

  /**
   * Fetch a value from the database.
   *
   * #### Notes
   * Unlike the public `fetch` method, this method is synchronous.
   */
  private _fetch(id: string): ReadonlyJSONValue | undefined {
      const key = `${this._window}:${this.namespace}:${id}`;
      const value = window.localStorage.getItem(key);

      if (value) {
        const envelope = JSON.parse(value) as Private.Envelope;

        return envelope.v;
      }

      return undefined;
  }

  /**
   * Merge data into the state database.
   */
  private _merge(contents: ReadonlyJSONObject): void {
    Object.keys(contents).forEach(key => { this._save(key, contents[key]); });
  }

  /**
   * Overwrite the entire database with new contents.
   */
  private _overwrite(contents: ReadonlyJSONObject): void {
    this._clear();
    this._merge(contents);
  }

  /**
   * Remove a key in the database.
   *
   * #### Notes
   * Unlike the public `remove` method, this method is synchronous.
   */
  private _remove(id: string): void {
    const key = `${this._window}:${this.namespace}:${id}`;

    window.localStorage.removeItem(key);
  }

  /**
   * Save a key and its value in the database.
   *
   * #### Notes
   * Unlike the public `save` method, this method is synchronous.
   */
  private _save(id: string, value: ReadonlyJSONValue): void {
    const key = `${this._window}:${this.namespace}:${id}`;
    const envelope: Private.Envelope = { v: value };
    const serialized = JSON.stringify(envelope);
    const length = serialized.length;
    const max = this.maxLength;

    if (length > max) {
      throw new Error(`Data length (${length}) exceeds maximum (${max})`);
    }

    window.localStorage.setItem(key, serialized);
  }

  private _changed = new Signal<this, StateDB.Change>(this);
  private _ready: Promise<void>;
  private _window: string;
}

/**
 * A namespace for StateDB statics.
 */
export
namespace StateDB {
  /**
   * A state database change.
   */
  export
  type Change = {
    /**
     * The key of the database item that was changed.
     *
     * #### Notes
     * This field is set to `null` for global changes (i.e. `clear`).
     */
    id: string | null;

    /**
     * The type of change.
     */
    type: 'clear' | 'remove' | 'save'
  };

  /**
   * A data transformation that can be applied to a state database.
   */
  export
  type DataTransform = {
    /*
     * The change operation being applied.
     */
    type: 'cancel' | 'clear' | 'merge' | 'overwrite',

    /**
     * The contents of the change operation.
     */
    contents: ReadonlyJSONObject | null
  };

  /**
   * The instantiation options for a state database.
   */
  export
  interface IOptions {
    /**
     * The namespace prefix for all state database entries.
     */
    namespace: string;

    /**
     * An optional promise that resolves with a data transformation that is
     * applied to the database contents before the database begins resolving
     * client requests.
     */
    transform?: Promise<DataTransform>;
  }
}


/*
 * A namespace for private module data.
 */
namespace Private {
  /**
   * An envelope around a JSON value stored in the state database.
   */
  export
  type Envelope = { readonly v: ReadonlyJSONValue };

  /**
   * The timeout (in ms) to wait for beacon responders.
   */
  const TIMEOUT = 100;

  /**
   * The internal prefix for private local storage keys.
   */
  const PREFIX = '@jupyterlab/coreutils:StateDB';

  /**
   * The local storage beacon key.
   */
  const BEACON = `${PREFIX}:beacon`;

  /**
   * The local storage window prefix.
   */
  const WINDOW = `${PREFIX}:window-`;

  /**
   * The window name.
   */
  let name: string;

  /**
   * The window name promise.
   */
  let promise: Promise<string>;

  /**
   * Wait until a window name is available and resolve.
   */
  function awaitName(resolve: (value: string) => void): void {
    window.setTimeout(() => {
      if (name) {
        return resolve(name);
      }

      createName().then(value => {
        name = value;
        resolve(name);
      });
    }, TIMEOUT);
  }

  /**
   * Create a name for this window.
   */
  function createName(): Promise<string> {
    console.log('I should generate a name');
    return Promise.resolve('');
  }

  /**
   * Fetch the known window names.
   */
  function fetchWindowNames(): { [name: string]: number } {
      const names: { [name: string]: number } = { };
      const { localStorage } = window;
      let i = localStorage.length;

      while (i) {
        let key = localStorage.key(--i);

        if (key && key.indexOf(WINDOW) === 0) {
          let name = key.replace(WINDOW, '');

          names[name] = parseInt(localStorage.getItem(key), 10);
        }
      }

      return names;
  }

  /**
   * Fire off the signal beacon to solicit pings from other JupyterLab windows.
   */
  function beacon(): void {
    window.localStorage.setItem(BEACON, `${(new Date()).getTime()}`);
  }

  /**
   * Respond to a signal beacon.
   */
  function ping(): void {
    if (name) {
      window.localStorage.setItem(name, `${(new Date()).getTime()}`);
    }
  }

  /**
   * The window storage event handler.
   */
  function storageHandler(event: StorageEvent) {
    const { key } = event;

    console.log('event key', key);

    if (key === BEACON) {
      console.log('The beacon has been fired');
      return ping();
    }

    if (key.indexOf(WINDOW) !== 0) {
      return;
    }

    const windows = fetchWindowNames();
    const name = key.replace(WINDOW, '');

    if (name in windows) {
      console.log(`Window ${name} is a known window.`);
    } else {
      console.log(`Window ${name} is an unknown window.`);
    }
  }

  /**
   * Returns a promise that resolves with the window name used for restoration.
   */
  export
  function windowName(): Promise<string> {
    return promise || (promise = new Promise((resolve) => {
      beacon();
      awaitName(resolve);
    }));
  }

  /**
   * Start the storage event handler immediately.
   */
  window.addEventListener('storage', storageHandler);
}
