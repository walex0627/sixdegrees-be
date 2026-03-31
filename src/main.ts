import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger('Bootstrap');

  // 1. Enable CORS (Cross-Origin Resource Sharing)
  // This allows your React app to communicate with the Backend
  app.enableCors({
    origin: '*', // In production, replace with your frontend URL (e.g., https://cinegraph.vercel.app)
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });

  // 2. Set a global prefix (optional but professional)
  // Your API will be at http://localhost:3000/api
  app.setGlobalPrefix('api');

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  
  logger.log(`Application is running on: http://localhost:${port}/api`);
  logger.log(`WebSockets are enabled on the same port`);
}
bootstrap();