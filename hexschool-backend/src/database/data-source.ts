import 'dotenv/config';
import { DataSource } from 'typeorm';

/**
 * TypeORM CLI data source (migration:generate / run / revert).
 * The runtime connection is configured separately in AppModule.
 */
const AppDataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: ['src/**/*.entity.ts'],
  migrations: ['src/database/migrations/*.ts'],
  synchronize: false,
  logging: process.env.NODE_ENV === 'development',
});

export default AppDataSource;
