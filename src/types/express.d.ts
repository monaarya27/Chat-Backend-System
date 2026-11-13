import 'express-serve-static-core';

declare module 'express-serve-static-core' {
  interface Request {
    /** Set by the `authenticate` middleware once the caller's identity is verified. */
    auth?: {
      userId: string;
      method: 'dev-header' | 'firebase';
    };
  }
}
