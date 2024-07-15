// Global Helpers
import { toHexString } from '@chainsafe/ssz';

// Helpers
import {
  mockedDvtOperators,
  mockedKeysApiFind,
  mockedKeysApiGetAllKeys,
  mockedKeysApiOperatorsMany,
  mockedMeta,
  mockedModule,
  mockedOperators,
  mockOperator1,
  mockOperator2,
  setupMockModules,
} from './helpers';

// Constants
import {
  TESTS_TIMEOUT,
  SLEEP_FOR_RESULT,
  STAKING_ROUTER,
  LIDO_WC,
  BAD_WC,
  CHAIN_ID,
  GANACHE_PORT,
  sk,
  pk,
  NOP_REGISTRY,
  SIMPLE_DVT,
  SECURITY_MODULE_V2,
  UNLOCKED_ACCOUNTS_V2,
  FORK_BLOCK_V2,
  SECURITY_MODULE_OWNER_V2,
  SANDBOX,
} from './constants';

// Contract Factories
import { StakingRouterAbi__factory } from './../src/generated';

// BLS helpers

// App modules and services
import {
  setupTestingModule,
  closeServer,
  initLevelDB,
} from './helpers/test-setup';
import { DepositService } from 'contracts/deposit';
import { GuardianService } from 'guardian';
import { KeysApiService } from 'keys-api/keys-api.service';
import { ProviderService } from 'provider';
import { Server } from 'ganache';
import { LevelDBService } from 'contracts/deposit/leveldb';
import { LevelDBService as SignKeyLevelDBService } from 'contracts/signing-key-events-cache/leveldb';
import { GuardianMessageService } from 'guardian/guardian-message';
import { SigningKeyEventsCacheService } from 'contracts/signing-key-events-cache';
import { makeServer } from './server';
import { addGuardians } from './helpers/dsm';
import { DepositIntegrityCheckerService } from 'contracts/deposit/integrity-checker';
import { BlsService } from 'bls';
import { makeDeposit, signDeposit } from './helpers/deposit';
import { mockKey, mockKey2 } from './helpers/keys-fixtures';

// Mock rabbit straight away
jest.mock('../src/transport/stomp/stomp.client.ts');

jest.setTimeout(10_000);

describe('ganache e2e tests', () => {
  let server: Server<'ethereum'>;
  let providerService: ProviderService;
  let keysApiService: KeysApiService;
  let guardianService: GuardianService;
  let depositService: DepositService;
  let sendDepositMessage: jest.SpyInstance;
  let sendPauseMessage: jest.SpyInstance;
  let levelDBService: LevelDBService;
  let signKeyLevelDBService: SignKeyLevelDBService;
  let guardianMessageService: GuardianMessageService;
  let signingKeyEventsCacheService: SigningKeyEventsCacheService;
  let depositIntegrityCheckerService: DepositIntegrityCheckerService;

  const setupServer = async () => {
    server = makeServer(FORK_BLOCK_V2, CHAIN_ID, UNLOCKED_ACCOUNTS_V2);
    await server.listen(GANACHE_PORT);
  };

  const setupGuardians = async () => {
    await addGuardians({
      securityModule: SECURITY_MODULE_V2,
      securityModuleOwner: SECURITY_MODULE_OWNER_V2,
    });
  };

  const setupTestingServices = async (moduleRef) => {
    // leveldb service
    levelDBService = moduleRef.get(LevelDBService);
    signKeyLevelDBService = moduleRef.get(SignKeyLevelDBService);

    await initLevelDB(levelDBService, signKeyLevelDBService);

    // deposit events related services
    depositIntegrityCheckerService = moduleRef.get(
      DepositIntegrityCheckerService,
    );
    depositService = moduleRef.get(DepositService);

    const blsService = moduleRef.get(BlsService);
    await blsService.onModuleInit();

    // keys events service
    signingKeyEventsCacheService = moduleRef.get(SigningKeyEventsCacheService);

    providerService = moduleRef.get(ProviderService);
    // keys api servies
    keysApiService = moduleRef.get(KeysApiService);

    // rabbitmq message sending methods
    guardianMessageService = moduleRef.get(GuardianMessageService);

    // main service that check keys and make decision
    guardianService = moduleRef.get(GuardianService);
  };

  const setupMocks = () => {
    // broker messages
    sendDepositMessage = jest
      .spyOn(guardianMessageService, 'sendDepositMessage')
      .mockImplementation(() => Promise.resolve());
    jest
      .spyOn(guardianMessageService, 'pingMessageBroker')
      .mockImplementation(() => Promise.resolve());
    sendPauseMessage = jest
      .spyOn(guardianMessageService, 'sendPauseMessageV2')
      .mockImplementation(() => Promise.resolve());

    // deposit cache mocks
    jest
      .spyOn(depositIntegrityCheckerService, 'checkLatestRoot')
      .mockImplementation(() => Promise.resolve());
    jest
      .spyOn(depositIntegrityCheckerService, 'checkFinalizedRoot')
      .mockImplementation(() => Promise.resolve());
  };

  beforeEach(async () => {
    await setupServer();
    await setupGuardians();
    const moduleRef = await setupTestingModule();
    await setupTestingServices(moduleRef);
    setupMocks();
  }, 20000);

  afterEach(async () => {
    await closeServer(server, levelDBService, signKeyLevelDBService);
  });

  test(
    'node operator deposit frontrun, 2 modules in staking router',
    async () => {
      const currentBlock = await providerService.provider.getBlock('latest');
      // create correct sign for deposit message for pk
      const { signature } = signDeposit(pk, sk, LIDO_WC);

      // Keys api mock
      // all keys in keys api on current block state
      const keys = [
        {
          key: toHexString(pk),
          depositSignature: toHexString(signature),
          operatorIndex: mockOperator1.index,
          used: false, // TODO: true
          index: 0,
          moduleAddress: NOP_REGISTRY,
        },
        // simple dvt
        mockKey2,
      ];

      // add in deposit cache event of deposit on key with lido creds
      // TODO: replace with real deposit
      await depositService.setCachedEvents({
        data: [],
        headers: {
          startBlock: currentBlock.number,
          endBlock: currentBlock.number,
        },
      });

      // dont set events for keys as we check this cahce only in case of duplicated keys
      await signingKeyEventsCacheService.setCachedEvents({
        data: [],
        headers: {
          startBlock: currentBlock.number,
          endBlock: currentBlock.number,
          stakingModulesAddresses: [NOP_REGISTRY, SIMPLE_DVT, SANDBOX],
        },
      });

      // Attempt to front run
      const { depositData: theftDepositData } = signDeposit(pk, sk, BAD_WC);
      const { wallet } = await makeDeposit(theftDepositData, providerService);

      // Mock Keys API again on new block
      const newBlock = await providerService.provider.getBlock('latest');

      setupMockModules(
        newBlock,
        keysApiService,
        [mockOperator1, mockOperator2],
        mockedDvtOperators,
        keys,
      );

      // Run a cycle and wait for possible changes
      await guardianService.handleNewBlock();
      await new Promise((res) => setTimeout(res, SLEEP_FOR_RESULT));

      // soft pause for 1 module, sign deposit for 2
      expect(sendPauseMessage).toBeCalledTimes(0);
      expect(sendDepositMessage).toBeCalledTimes(1);
      expect(sendDepositMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          blockNumber: newBlock.number,
          guardianAddress: wallet.address,
          guardianIndex: 7,
          stakingModuleId: 2,
        }),
      );
    },
    TESTS_TIMEOUT,
  );

  test(
    'failed 1eth deposit attack to stop deposits',
    async () => {
      const currentBlock = await providerService.provider.getBlock('latest');

      await depositService.setCachedEvents({
        data: [],
        headers: {
          startBlock: currentBlock.number,
          endBlock: currentBlock.number,
        },
      });

      await signingKeyEventsCacheService.setCachedEvents({
        data: [],
        headers: {
          startBlock: currentBlock.number,
          endBlock: currentBlock.number,
          stakingModulesAddresses: [NOP_REGISTRY, SIMPLE_DVT, SANDBOX],
        },
      });

      const { signature: goodSign } = signDeposit(pk, sk, LIDO_WC, 32000000000);

      const { depositData: depositData } = signDeposit(
        pk,
        sk,
        LIDO_WC,
        1000000000,
      );
      await makeDeposit(depositData, providerService, 1);

      // Mock Keys API
      const keys = [
        {
          key: toHexString(pk),
          depositSignature: toHexString(goodSign),
          operatorIndex: mockOperator1.index,
          used: false, // TODO: true
          index: 0,
          moduleAddress: NOP_REGISTRY,
        },
        // simple dvt
        mockKey2,
      ];

      setupMockModules(
        currentBlock,
        keysApiService,
        [mockOperator1, mockOperator2],
        mockedDvtOperators,
        keys,
      );

      // we make check that there are no duplicated used keys
      // this request return keys along with their duplicates
      // mockedKeysApiFind(keysApiService, unusedKeys, newMeta);

      // Run a cycle and wait for possible changes
      await guardianService.handleNewBlock();
      await new Promise((res) => setTimeout(res, SLEEP_FOR_RESULT));
      // Check if on pause now
      const routerContract = StakingRouterAbi__factory.connect(
        STAKING_ROUTER,
        providerService.provider,
      );

      const isOnPause = await routerContract.getStakingModuleIsDepositsPaused(
        1,
      );
      expect(isOnPause).toBe(false);
      expect(sendPauseMessage).toBeCalledTimes(0);
      expect(sendDepositMessage).toBeCalledTimes(2);
    },
    TESTS_TIMEOUT,
  );

  test(
    'failed 1eth deposit attack to stop deposits with a wrong signature and wc',
    async () => {
      const currentBlock = await providerService.provider.getBlock('latest');

      await depositService.setCachedEvents({
        data: [],
        headers: {
          startBlock: currentBlock.number,
          endBlock: currentBlock.number,
        },
      });

      await signingKeyEventsCacheService.setCachedEvents({
        data: [],
        headers: {
          startBlock: currentBlock.number,
          endBlock: currentBlock.number,
          stakingModulesAddresses: [NOP_REGISTRY, SIMPLE_DVT, SANDBOX],
        },
      });

      const { signature: goodSign } = signDeposit(pk, sk, LIDO_WC, 32000000000);

      // wrong deposit, fill not set on soft pause deposits
      const { signature: weirdSign } = signDeposit(pk, sk, BAD_WC, 0);
      const { depositData } = signDeposit(pk, sk, BAD_WC, 1000000000);
      await makeDeposit(
        { ...depositData, signature: weirdSign },
        providerService,
        1,
      );

      const unusedKeys = [
        {
          key: toHexString(pk),
          depositSignature: toHexString(goodSign),
          operatorIndex: mockOperator1.index,
          used: false,
          index: 0,
          moduleAddress: NOP_REGISTRY,
        },
      ];

      setupMockModules(
        currentBlock,
        keysApiService,
        [mockOperator1, mockOperator2],
        mockedDvtOperators,
        unusedKeys,
      );

      // Run a cycle and wait for possible changes
      await guardianService.handleNewBlock();
      await new Promise((res) => setTimeout(res, SLEEP_FOR_RESULT));
      expect(sendPauseMessage).toBeCalledTimes(0);
      expect(sendDepositMessage).toBeCalledTimes(2);
    },
    TESTS_TIMEOUT,
  );

  test(
    'good scenario',
    async () => {
      const currentBlock = await providerService.provider.getBlock('latest');

      await depositService.setCachedEvents({
        data: [],
        headers: {
          startBlock: currentBlock.number,
          endBlock: currentBlock.number,
        },
      });

      await signingKeyEventsCacheService.setCachedEvents({
        data: [],
        headers: {
          startBlock: currentBlock.number,
          endBlock: currentBlock.number,
          stakingModulesAddresses: [NOP_REGISTRY, SIMPLE_DVT, SANDBOX],
        },
      });

      const { signature: goodSign, depositData } = signDeposit(
        pk,
        sk,
        LIDO_WC,
        32000000000,
      );

      const { wallet } = await makeDeposit(depositData, providerService);

      const unusedKeys = [
        {
          key: toHexString(pk),
          depositSignature: toHexString(goodSign),
          operatorIndex: mockOperator1.index,
          used: false,
          index: 0,
          moduleAddress: NOP_REGISTRY,
        },
      ];

      setupMockModules(
        currentBlock,
        keysApiService,
        [mockOperator1, mockOperator2],
        mockedDvtOperators,
        unusedKeys,
      );

      // Check if the service is ok and ready to go
      await guardianService.handleNewBlock();
      await new Promise((res) => setTimeout(res, SLEEP_FOR_RESULT));

      expect(sendDepositMessage).toBeCalledTimes(2);
      expect(sendDepositMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          blockNumber: currentBlock.number,
          guardianAddress: wallet.address,
          guardianIndex: 7,
          stakingModuleId: 1,
        }),
      );
      expect(sendDepositMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          blockNumber: currentBlock.number,
          guardianAddress: wallet.address,
          guardianIndex: 7,
          stakingModuleId: 2,
        }),
      );

      // Check if on pause now
      const routerContract = StakingRouterAbi__factory.connect(
        STAKING_ROUTER,
        providerService.provider,
      );
      const isOnPause = await routerContract.getStakingModuleIsDepositsPaused(
        1,
      );
      expect(isOnPause).toBe(false);
    },
    TESTS_TIMEOUT,
  );

  test(
    'inconsistent kapi requests data',
    async () => {
      const currentBlock = await providerService.provider.getBlock('latest');
      await depositService.setCachedEvents({
        data: [],
        headers: {
          startBlock: currentBlock.number,
          endBlock: currentBlock.number,
        },
      });

      // mocked curated module
      const stakingModule = mockedModule(currentBlock, currentBlock.hash);
      const meta = mockedMeta(currentBlock, currentBlock.hash);

      mockedKeysApiOperatorsMany(
        keysApiService,
        [{ operators: mockedOperators, module: stakingModule }],
        meta,
      );

      const unusedKeys = [mockKey];

      const hashWasChanged =
        '0xd921055dbb407e09f64afe5182a64c1bd309fe28f26909a96425cdb6bfc48959';
      const newMeta = mockedMeta(currentBlock, hashWasChanged);
      mockedKeysApiGetAllKeys(keysApiService, unusedKeys, newMeta);

      await guardianService.handleNewBlock();

      expect(sendDepositMessage).toBeCalledTimes(0);
      expect(sendPauseMessage).toBeCalledTimes(0);
    },
    TESTS_TIMEOUT,
  );

  test(
    'historical front-run',
    async () => {
      const currentBlock = await providerService.provider.getBlock('latest');

      await depositService.setCachedEvents({
        data: [],
        headers: {
          startBlock: currentBlock.number,
          endBlock: currentBlock.number,
        },
      });

      await signingKeyEventsCacheService.setCachedEvents({
        data: [],
        headers: {
          startBlock: currentBlock.number,
          endBlock: currentBlock.number,
          stakingModulesAddresses: [NOP_REGISTRY, SIMPLE_DVT, SANDBOX],
        },
      });

      const { signature: lidoSign } = signDeposit(pk, sk);
      const { signature: theftDepositSign } = signDeposit(pk, sk, BAD_WC);

      const keys = [
        {
          key: toHexString(pk),
          depositSignature: toHexString(lidoSign),
          operatorIndex: 0,
          used: true,
          index: 0,
          moduleAddress: NOP_REGISTRY,
        },
      ];

      setupMockModules(
        currentBlock,
        keysApiService,
        [mockOperator1, mockOperator2],
        mockedDvtOperators,
        keys,
      );

      mockedKeysApiFind(
        keysApiService,
        keys,
        mockedMeta(currentBlock, currentBlock.hash),
      );

      await depositService.setCachedEvents({
        data: [
          {
            valid: true,
            pubkey: toHexString(pk),
            amount: '32000000000',
            wc: BAD_WC,
            signature: toHexString(theftDepositSign),
            tx: '0x122',
            blockHash: '0x123456',
            blockNumber: currentBlock.number - 1,
            logIndex: 1,
            depositCount: 1,
            depositDataRoot: new Uint8Array(),
            index: '',
          },
          {
            valid: true,
            pubkey: toHexString(pk),
            amount: '32000000000',
            wc: LIDO_WC,
            signature: toHexString(lidoSign),
            tx: '0x123',
            blockHash: currentBlock.hash,
            blockNumber: currentBlock.number,
            logIndex: 1,
            depositCount: 2,
            depositDataRoot: new Uint8Array(),
            index: '',
          },
        ],
        headers: {
          startBlock: currentBlock.number,
          endBlock: currentBlock.number,
        },
      });

      await guardianService.handleNewBlock();

      await new Promise((res) => setTimeout(res, SLEEP_FOR_RESULT));

      const routerContract = StakingRouterAbi__factory.connect(
        STAKING_ROUTER,
        providerService.provider,
      );
      const isOnPause = await routerContract.getStakingModuleIsDepositsPaused(
        1,
      );

      expect(isOnPause).toBe(true);

      const isOnPause2 = await routerContract.getStakingModuleIsDepositsPaused(
        2,
      );

      expect(isOnPause2).toBe(true);
    },
    TESTS_TIMEOUT,
  );

  // test(
  //   'reorganization',
  //   async () => {
  //     const tempProvider = new ethers.providers.JsonRpcProvider(
  //       `http://127.0.0.1:${GANACHE_PORT}`,
  //     );
  //     const currentBlock = await tempProvider.getBlock('latest');

  //     const goodDepositMessage = {
  //       pubkey: pk,
  //       withdrawalCredentials: fromHexString(LIDO_WC),
  //       amount: 32000000000, // gwei!
  //     };
  //     const goodSigningRoot = computeRoot(goodDepositMessage);
  //     const goodSig = sk.sign(goodSigningRoot).toBytes();

  //     const unusedKeys = [
  //       {
  //         key: toHexString(pk),
  //         depositSignature: toHexString(goodSig),
  //         operatorIndex: 0,
  //         used: false,
  //         index: 0,
  //         moduleAddress: NOP_REGISTRY,
  //       },
  //     ];

  //     const meta = mockedMeta(currentBlock, currentBlock.hash);
  //     const stakingModule = mockedModule(currentBlock, currentBlock.hash);

  //     mockedKeysApiOperators(
  //       keysApiService,
  //       mockedOperators,
  //       stakingModule,
  //       meta,
  //     );

  //     mockedKeysApiGetAllKeys(keysApiService, unusedKeys, meta);

  //     const goodDepositData = {
  //       ...goodDepositMessage,
  //       signature: goodSig,
  //     };
  //     const goodDepositDataRoot = DepositData.hashTreeRoot(goodDepositData);

  //     await depositService.setCachedEvents({
  //       data: [],
  //       headers: {
  //         startBlock: currentBlock.number,
  //         endBlock: currentBlock.number,
  //         version: '1',
  //       },
  //     });

  //     // Check if the service is ok and ready to go
  //     await guardianService.handleNewBlock();

  //     // Wait for possible changes
  //     await new Promise((res) => setTimeout(res, SLEEP_FOR_RESULT));

  //     const routerContract = StakingRouterAbi__factory.connect(
  //       STAKING_ROUTER,
  //       providerService.provider,
  //     );
  //     const isOnPauseBefore =
  //       await routerContract.getStakingModuleIsDepositsPaused(1);
  //     expect(isOnPauseBefore).toBe(false);

  //     if (!process.env.WALLET_PRIVATE_KEY) throw new Error(NO_PRIVKEY_MESSAGE);
  //     const wallet = new ethers.Wallet(process.env.WALLET_PRIVATE_KEY);

  //     // Make a deposit
  //     const signer = wallet.connect(providerService.provider);
  //     const depositContract = DepositAbi__factory.connect(
  //       DEPOSIT_CONTRACT,
  //       signer,
  //     );
  //     await depositContract.deposit(
  //       goodDepositData.pubkey,
  //       goodDepositData.withdrawalCredentials,
  //       goodDepositData.signature,
  //       goodDepositDataRoot,
  //       { value: ethers.constants.WeiPerEther.mul(32) },
  //     );

  //     // Mock Keys API again on new block, but now mark as used
  //     const newBlock = await providerService.provider.getBlock('latest');
  //     const newMeta = mockedMeta(newBlock, newBlock.hash);
  //     const newStakingModule = mockedModule(currentBlock, newBlock.hash);

  //     mockedKeysApiOperators(
  //       keysApiService,
  //       mockedOperators,
  //       newStakingModule,
  //       newMeta,
  //     );

  //     mockedKeysApiGetAllKeys(
  //       keysApiService,
  //       [
  //         {
  //           key: toHexString(pk),
  //           depositSignature: toHexString(goodSig),
  //           operatorIndex: 0,
  //           used: true,
  //           index: 0,
  //           moduleAddress: NOP_REGISTRY,
  //         },
  //       ],
  //       newMeta,
  //     );

  //     // Run a cycle and wait for possible changes
  //     await guardianService.handleNewBlock();
  //     await new Promise((res) => setTimeout(res, SLEEP_FOR_RESULT));

  //     const isOnPauseMiddle =
  //       await routerContract.getStakingModuleIsDepositsPaused(1);
  //     expect(isOnPauseMiddle).toBe(false);

  //     // Simulating a reorg
  //     await server.close();
  //     server = makeServer(FORK_BLOCK, CHAIN_ID, UNLOCKED_ACCOUNTS);
  //     await server.listen(GANACHE_PORT);

  //     mockedKeysApiGetAllKeys(keysApiService, unusedKeys, newMeta);
  //     mockedKeysApiFind(keysApiService, unusedKeys, newMeta);

  //     // Check if on pause now
  //     const isOnPauseAfter =
  //       await routerContract.getStakingModuleIsDepositsPaused(1);
  //     expect(isOnPauseAfter).toBe(false);
  //   },
  //   TESTS_TIMEOUT,
  // );

  // TODO: do we need it?
  // test(
  //   'duplicates will not block front-run recognition',
  //   async () => {
  //     const tempProvider = new ethers.providers.JsonRpcProvider(
  //       `http://127.0.0.1:${GANACHE_PORT}`,
  //     );
  //     const forkBlock = await tempProvider.getBlock(FORK_BLOCK);
  //     const currentBlock = await tempProvider.getBlock('latest');

  //     const { deposit_sign: goodSig } = await makeDeposit(
  //       pk,
  //       sk,
  //       providerService,
  //     );

  //     const unusedKeys = [
  //       {
  //         key: toHexString(pk),
  //         depositSignature: toHexString(goodSig),
  //         operatorIndex: 0,
  //         used: false,
  //         index: 0,
  //         moduleAddress: NOP_REGISTRY,
  //       },
  //     ];

  //     const meta = mockedMeta(currentBlock, currentBlock.hash);
  //     const stakingModule = mockedModule(currentBlock, currentBlock.hash);

  //     mockedKeysApiOperatorsMany(
  //       keysApiService,
  //       [{ operators: mockedOperators, module: stakingModule }],
  //       meta,
  //     );

  //     mockedKeysApiGetAllKeys(keysApiService, unusedKeys, meta);
  //     mockedKeysApiFind(keysApiService, unusedKeys, meta);

  //     // just to start checks set event in cache
  //     await depositService.setCachedEvents({
  //       data: [
  //         {
  //           valid: true,
  //           pubkey: toHexString(pk),
  //           amount: '32000000000',
  //           wc: LIDO_WC,
  //           signature: toHexString(goodSig),
  //           tx: '0x123',
  //           blockHash: forkBlock.hash,
  //           blockNumber: forkBlock.number,
  //           logIndex: 1,
  //           depositCount: 1,
  //           depositDataRoot: new Uint8Array(),
  //           index: '',
  //         },
  //       ],
  //       headers: {
  //         startBlock: currentBlock.number,
  //         endBlock: currentBlock.number,
  //       },
  //     });

  //     jest
  //       .spyOn(signingKeyEventsCacheService, 'getStakingModules')
  //       .mockImplementation(() =>
  //         Promise.resolve([NOP_REGISTRY, SIMPLE_DVT]),
  //       );

  //     await signingKeyEventsCacheService.setCachedEvents({
  //       data: [],
  //       headers: {
  //         startBlock: currentBlock.number,
  //         endBlock: currentBlock.number,
  //         stakingModulesAddresses: [NOP_REGISTRY, SIMPLE_DVT],
  //       },
  //     });

  //     // Check if the service is ok and ready to go
  //     await guardianService.handleNewBlock();

  //     expect(getFrontRunAttempts).toBeCalledTimes(1);
  //     expect(sendDepositMessage).toBeCalledTimes(1);

  //     await makeDeposit(pk, sk, providerService, BAD_WC);

  //     // Mock Keys API again on new block
  //     const newBlock = await providerService.provider.getBlock('latest');
  //     const newMeta = mockedMeta(newBlock, newBlock.hash);
  //     const updatedStakingModule = mockedModule(currentBlock, newBlock.hash);

  //     mockedKeysApiOperatorsMany(
  //       keysApiService,
  //       [{ operators: mockedOperators, module: updatedStakingModule }],
  //       newMeta,
  //     );

  //     const duplicate = {
  //       key: toHexString(pk),
  //       depositSignature: toHexString(goodSig),
  //       operatorIndex: 0,
  //       used: false,
  //       index: 1,
  //       moduleAddress: NOP_REGISTRY,
  //     };

  //     mockedKeysApiGetAllKeys(
  //       keysApiService,
  //       [...unusedKeys, duplicate],
  //       newMeta,
  //     );

  //     sendDepositMessage.mockClear();
  //     getFrontRunAttempts.mockClear();

  //     // Run a cycle and wait for possible changes
  //     await guardianService.handleNewBlock();

  //     await new Promise((res) => setTimeout(res, SLEEP_FOR_RESULT));

  //     const routerContract = StakingRouterAbi__factory.connect(
  //       STAKING_ROUTER,
  //       providerService.provider,
  //     );
  //     const isOnPause = await routerContract.getStakingModuleIsDepositsPaused(
  //       1,
  //     );
  //     expect(isOnPause).toBe(false);

  //     expect(getFrontRunAttempts).toBeCalledTimes(1);
  //     expect(sendDepositMessage).toBeCalledTimes(0);
  //   },
  //   TESTS_TIMEOUT,
  // );
});
