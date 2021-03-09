/** Supported Sentry transport protocols in a Dsn. */
export type DsnProtocol = 'http' | 'https';

/** Primitive components of a Dsn. */
export interface DsnComponents {
  /** Protocol used to connect to Sentry. */
  protocol: DsnProtocol;
  /** Public authorization key (deprecated, renamed to publicKey). */
  user?: string;
  /** Public authorization key. */
  publicKey?: string;
  /** Private authorization key (deprecated, optional). */
  pass?: string;
  /** Hostname of the Sentry instance. */
  host: string;
  /** Port of the Sentry instance. */
  port?: string;
  /** Sub path/ */
  path?: string;
  /** Project ID */
  projectId: string;
}

/** Anything that can be parsed into a Dsn. */
export type DsnLike = string | DsnComponents;

/** The Sentry Dsn, identifying a Sentry instance and project. */
export interface Dsn extends DsnComponents {
  toString(): string;
}
