import { Transform } from 'class-transformer';
import {
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateIf,
} from 'class-validator';
import { Injectable } from '@nestjs/common';
import { Configuration, PubsubService } from './configuration';
import { SASLMechanism } from '../../transport';
import { implementationOf } from '../di/decorators/implementationOf';

const RABBITMQ = 'rabbitmq';
const KAFKA = 'kafka';

@Injectable()
@implementationOf(Configuration)
export class InMemoryConfiguration implements Configuration {
  @IsNotEmpty()
  @IsIn(['development', 'production', 'test'])
  NODE_ENV = 'development';

  @IsNotEmpty()
  @IsNumber()
  @Min(1)
  @Transform(({ value }) => parseInt(value, 10), { toClassOnly: true })
  PORT = 3000;

  @IsNotEmpty()
  @IsIn(['error', 'warning', 'notice', 'info', 'debug'])
  LOG_LEVEL = 'info';

  @IsString()
  @IsIn(['simple', 'json'])
  LOG_FORMAT = 'json';

  @IsNotEmpty()
  @IsString()
  RPC_URL = '';

  @IsString()
  WALLET_PRIVATE_KEY = '';

  @IsString()
  KAFKA_CLIENT_ID = '';

  @IsString()
  BROKER_TOPIC = 'defender';

  @IsString()
  @IsIn([KAFKA, RABBITMQ])
  PUBSUB_SERVICE: PubsubService = RABBITMQ;

  @ValidateIf((conf) => conf.PUBSUB_SERVICE === KAFKA)
  @IsNotEmpty()
  @IsString()
  KAFKA_BROKER_ADDRESS_1 = '';

  @ValidateIf((conf) => conf.PUBSUB_SERVICE === KAFKA)
  @IsString()
  KAFKA_BROKER_ADDRESS_2 = '';

  @ValidateIf((conf) => conf.PUBSUB_SERVICE === KAFKA)
  @IsNotEmpty()
  @Transform(({ value }) => (value.toLowerCase() == 'true' ? true : false), {
    toClassOnly: true,
  })
  KAFKA_SSL = false;

  @ValidateIf((conf) => conf.PUBSUB_SERVICE === KAFKA)
  @IsNotEmpty()
  @IsString()
  @IsIn(['plain', 'scram-sha-256', 'scram-sha-512'])
  KAFKA_SASL_MECHANISM: SASLMechanism = 'scram-sha-256';

  @ValidateIf((conf) => conf.PUBSUB_SERVICE === KAFKA)
  @IsNotEmpty()
  @IsString()
  KAFKA_USERNAME = '';

  @ValidateIf((conf) => conf.PUBSUB_SERVICE === KAFKA)
  @IsNotEmpty()
  @IsString()
  KAFKA_PASSWORD = '';

  @ValidateIf((conf) => conf.PUBSUB_SERVICE === RABBITMQ)
  @IsNotEmpty()
  @IsString()
  RABBITMQ_URL = '';

  @ValidateIf((conf) => conf.PUBSUB_SERVICE === RABBITMQ)
  @IsNotEmpty()
  @IsString()
  RABBITMQ_LOGIN = '';

  @ValidateIf((conf) => conf.PUBSUB_SERVICE === RABBITMQ)
  @IsNotEmpty()
  @IsString()
  RABBITMQ_PASSCODE = '';

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Transform(({ value }) => parseInt(value, 10), { toClassOnly: true })
  REGISTRY_KEYS_QUERY_BATCH_SIZE = 200;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Transform(({ value }) => parseInt(value, 10), { toClassOnly: true })
  REGISTRY_KEYS_QUERY_CONCURRENCY = 5;

  @IsNotEmpty()
  @IsNumber()
  @Min(1)
  @Transform(({ value }) => parseInt(value, 10), { toClassOnly: true })
  KEYS_API_PORT = 3001;

  @IsOptional()
  @IsString()
  KEYS_API_HOST = 'http://localhost';
}
