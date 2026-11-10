// Ứng dụng Express của API phòng khám. Dùng chung cho server.js (máy dev, host thường) và api/index.js (Vercel).
import cookieParser from 'cookie-parser';
import express from 'express';
import { authRouter, requireAuth } from './auth.js';
import { errorHandler } from './errors.js';
import { buildOpenApi, SWAGGER_HTML } from './openapi.js';
import { adminRouter } from './routes/admin.js';
import { appointmentsRouter, remindersRouter } from './routes/appointments.js';
import { billingRouter } from './routes/billing.js';
import { patientsRouter } from './routes/patients.js';
import { reportsRouter } from './routes/reports.js';
import { securityRouter } from './routes/security.js';
import { treatmentRouter } from './routes/treatment.js';

const isProduction = process.env.NODE_ENV === 'production';

// Router nghiệp vụ dưới /api, tất cả cần đăng nhập (requireAuth) và mỗi route có authorize('<mã quyền>').
// Danh sách này vừa để mount vừa để sinh tài liệu Swagger.
export const API_MOUNTS = [
  ['/patients', patientsRouter],
  ['/appointments', appointmentsRouter],
  ['/reminders', remindersRouter],
  ['', treatmentRouter],
  ['', billingRouter],
  ['', adminRouter],
  ['', reportsRouter],
  ['', securityRouter],
];

const app = express();
app.disable('x-powered-by');
// Host production (Render, Railway…) đặt API sau một proxy HTTPS → tin header X-Forwarded-* của proxy đó
if (isProduction) app.set('trust proxy', 1);
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

// Công khai: kiểm tra sống, tài liệu, đăng nhập
app.get('/api/health', (req, res) => res.json({ ok: true }));
app.get('/api/openapi.json', async (req, res) => {
  res.json(await buildOpenApi({ authRoutes: authRouter, mounts: API_MOUNTS }));
});
app.get(['/api/docs', '/api/docs/'], (req, res) => res.type('html').send(SWAGGER_HTML));
app.use('/api/auth', authRouter);

const api = express.Router();
api.use(requireAuth);
for (const [prefix, router] of API_MOUNTS) {
  if (prefix) api.use(prefix, router);
  else api.use(router);
}
app.use('/api', api);

app.use('/api', (req, res) => res.status(404).json({ error: 'Không có API này' }));
app.use(errorHandler);

export default app;
