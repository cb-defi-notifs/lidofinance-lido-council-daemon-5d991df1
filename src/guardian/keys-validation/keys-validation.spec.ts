import { Test } from '@nestjs/testing';
import { KeysValidationModule } from './keys-validation.module';
import {
  KeyValidatorInterface,
  KeyValidatorModule,
  bufferFromHexString,
} from '@lido-nestjs/key-validation';
import { KeysValidationService } from './keys-validation.service';
import { LoggerModule } from 'common/logger';
import { ConfigModule } from 'common/config';
import { MockProviderModule } from 'provider';
import {
  invalidKey1,
  invalidKey2,
  invalidKey2GoodSign,
  validKeys,
} from './keys.fixtures';
import { GENESIS_FORK_VERSION_BY_CHAIN_ID } from 'bls/bls.constants';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';

describe('KeysValidationService', () => {
  let keysValidationService: KeysValidationService;
  let keysValidator: KeyValidatorInterface;
  let validateKeysFun: jest.SpyInstance;

  const wc =
    '0x010000000000000000000000dc62f9e8c34be08501cdef4ebde0a280f576d762';

  const fork = GENESIS_FORK_VERSION_BY_CHAIN_ID[5];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot(),
        MockProviderModule.forRoot(),
        LoggerModule,
        KeyValidatorModule.forFeature({ multithreaded: true }),
        KeysValidationModule,
      ],
    }).compile();

    keysValidationService = moduleRef.get(KeysValidationService);
    keysValidator = moduleRef.get(KeyValidatorInterface);

    validateKeysFun = jest.spyOn(keysValidator, 'validateKeys');

    const loggerService = moduleRef.get(WINSTON_MODULE_NEST_PROVIDER);
    jest.spyOn(loggerService, 'warn').mockImplementation(() => undefined);
    jest.spyOn(loggerService, 'log').mockImplementation(() => undefined);
  });

  describe('Validate again if signature was changed', () => {
    beforeEach(() => {
      validateKeysFun.mockClear();
    });

    it('validate without use of cache', async () => {
      const keysForValidation = [...validKeys, invalidKey1, invalidKey2];
      const result = await keysValidationService.getInvalidKeys(
        keysForValidation,
        wc,
      );

      // we extended RegistryKey to satisfy DepositData type
      const depositKeyList = keysForValidation.map((key) => ({
        ...key,
        depositSignature: key.depositSignature,
        withdrawalCredentials: bufferFromHexString(wc),
        genesisForkVersion: Buffer.from(fork.buffer),
      }));

      expect(validateKeysFun).toBeCalledTimes(1);
      expect(validateKeysFun).toBeCalledWith(depositKeyList);
      expect(result).toEqual([invalidKey1, invalidKey2]);
    });

    it('validate with use of cache ', async () => {
      // Test scenario where one invalid key was removed from request's list
      const newResult = await keysValidationService.getInvalidKeys(
        [...validKeys, invalidKey1, invalidKey2],
        wc,
      );

      expect(validateKeysFun).toBeCalledTimes(1);
      expect(validateKeysFun).toBeCalledWith([]);
      expect(newResult).toEqual([invalidKey1, invalidKey2]);
    });

    it('validate without use of cache because of signature change', async () => {
      const invalidKey2Fix = {
        ...invalidKey2,
        depositSignature: invalidKey2GoodSign,
      };
      const keyForValidation = [
        ...validKeys,
        invalidKey1,
        // change signature on valid
        invalidKey2Fix,
      ];
      const newResult = await keysValidationService.getInvalidKeys(
        keyForValidation,
        wc,
      );
      const depositKeyList = [invalidKey2Fix].map((key) => ({
        ...key,
        withdrawalCredentials: bufferFromHexString(wc),
        genesisForkVersion: Buffer.from(fork.buffer),
      }));

      expect(validateKeysFun).toBeCalledTimes(1);
      expect(validateKeysFun).toBeCalledWith(depositKeyList);
      expect(newResult).toEqual([invalidKey1]);
    });
  });
});
