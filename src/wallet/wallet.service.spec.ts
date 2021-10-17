import { hexZeroPad } from '@ethersproject/bytes';
import { getNetwork } from '@ethersproject/networks';
import { JsonRpcProvider } from '@ethersproject/providers';
import { Wallet } from '@ethersproject/wallet';
import { CHAINS } from '@lido-sdk/constants';
import { Test } from '@nestjs/testing';
import { ConfigModule } from 'common/config';
import { LoggerModule } from 'common/logger';
import { PrometheusModule } from 'common/prometheus';
import { ProviderModule } from 'provider';
import { WALLET_PRIVATE_KEY } from './wallet.constants';
import { WalletService } from './wallet.service';

describe('WalletService', () => {
  const wallet = Wallet.createRandom();
  let walletService: WalletService;

  class MockRpcProvider extends JsonRpcProvider {
    async _uncachedDetectNetwork() {
      return getNetwork(CHAINS.Goerli);
    }
  }

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot(),
        LoggerModule,
        PrometheusModule,
        ProviderModule,
      ],
      providers: [
        WalletService,
        {
          provide: WALLET_PRIVATE_KEY,
          useValue: wallet.privateKey,
        },
      ],
    })
      .overrideProvider(JsonRpcProvider)
      .useValue(new MockRpcProvider())
      .compile();

    walletService = moduleRef.get(WalletService);
  });

  describe('wallet', () => {
    it('should return a wallet', async () => {
      expect(walletService.wallet).toBeInstanceOf(Wallet);
    });

    it('should cache instance', async () => {
      expect(walletService.wallet).toBe(walletService.wallet);
    });
  });

  describe('address', () => {
    it('should return correct address', async () => {
      expect(walletService.address).toBe(wallet.address);
    });
  });

  describe('signDepositData', () => {
    it('should sign deposit data', async () => {
      const prefix = hexZeroPad('0x1', 32);
      const depositRoot = hexZeroPad('0x2', 32);
      const keysOpIndex = 1;
      const blockNumber = 1;
      const blockHash = hexZeroPad('0x3', 32);
      const signature = await walletService.signDepositData(
        prefix,
        depositRoot,
        keysOpIndex,
        blockNumber,
        blockHash,
      );

      expect(signature).toEqual(
        expect.objectContaining({
          _vs: expect.any(String),
          r: expect.any(String),
          s: expect.any(String),
          v: expect.any(Number),
        }),
      );
    });
  });

  describe('signPauseData', () => {
    it('should sign pause data', async () => {
      const prefix = hexZeroPad('0x1', 32);
      const blockNumber = 1;
      const signature = await walletService.signPauseData(prefix, blockNumber);

      expect(signature).toEqual(
        expect.objectContaining({
          _vs: expect.any(String),
          r: expect.any(String),
          s: expect.any(String),
          v: expect.any(Number),
        }),
      );
    });
  });
});
