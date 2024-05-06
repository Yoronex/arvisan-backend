import bodyParser from 'body-parser';
import express, { Response as ExResponse, Request as ExRequest, NextFunction } from 'express';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import { ValidateError } from '@tsoa/runtime';
import { RegisterRoutes } from '../build/routes';
import apiDocs from '../build/swagger.json';

/**
 * Create an Express instance to listen to HTTP calls.
 * Directly assigns all middlewares and routes.
 *
 * HTTP is only used for the end user to interact with the software,
 * i.e. changing settings or modes.
 */
export default async function createHttp() {
  const app = express();

  app.use(
    bodyParser.urlencoded({
      extended: true,
      limit: '100mb',
    }),
  );
  app.use(bodyParser.json({ limit: '100mb' }));
  app.use(cors({ credentials: true, origin: process.env.HTTP_FRONTEND_URL }));

  /**
   * HTTP Basic Auth on all endpoints. Only enabled if username and password are defined
   */
  if (!!process.env.HTTP_BASIC_AUTH_USERNAME && !!process.env.HTTP_BASIC_AUTH_PASSWORD) {
    app.use((req, res, next) => {
      const auth = {
        login: process.env.HTTP_BASIC_AUTH_USERNAME,
        password: process.env.HTTP_BASIC_AUTH_PASSWORD,
      }; // change this

      // parse login and password from headers
      const b64auth = (req.headers.authorization || '').split(' ')[1] || '';
      const [login, password] = atob(b64auth).split(':');

      // Verify login and password are set and correct
      if (login && password && login === auth.login && password === auth.password) {
        // Access granted...
        return next();
      }

      // Access denied...
      res.set('WWW-Authenticate', 'Basic realm="401"');
      res.status(401).send('Authentication required.');
      return res;
    });
  }

  RegisterRoutes(app);

  if (process.env.NODE_ENV === 'development') {
    app.use('/api-docs', swaggerUi.serve, async (_req: ExRequest, res: ExResponse) => res.send(
      swaggerUi.generateHTML(apiDocs),
    ));
    // app.use('/static', express.static('public'));
  }

  app.use((
    err: unknown,
    req: ExRequest,
    res: ExResponse,
    next: NextFunction,
    // eslint-disable-next-line consistent-return
  ): ExResponse | void => {
    if (err instanceof ValidateError) {
      console.warn(`Caught Validation Error for ${req.path}:`, err.fields);
      res.status(422).json({
        message: 'Validation Failed',
        details: err?.fields,
      });
      return;
    }
    if (err instanceof Error) {
      console.error(err);
      res.status(500).json({
        message: 'Internal Server Error',
      });
      return;
    }

    next();
  });

  return app;
}
