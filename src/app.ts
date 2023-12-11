import express, {
  json, urlencoded, Response as ExResponse, Request as ExRequest,
} from 'express';
import swaggerUi from 'swagger-ui-express';
import { RegisterRoutes } from '../build/routes';

export const app = express();

// Use body parser to read sent json payloads
app.use(
  urlencoded({
    extended: true,
  }),
);
app.use(json());
app.use('/api-docs', swaggerUi.serve, async (_req: ExRequest, res: ExResponse) => res.send(
  swaggerUi.generateHTML(await import('../build/swagger.json')),
));

RegisterRoutes(app);
