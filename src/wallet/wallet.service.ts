import { defaultAbiCoder } from '@ethersproject/abi';
import { Signature } from '@ethersproject/bytes';
import { keccak256 } from '@ethersproject/keccak256';
import { formatEther } from '@ethersproject/units';
import { Wallet } from '@ethersproject/wallet';
import {
  Inject,
  Injectable,
  LoggerService,
  OnModuleInit,
} from '@nestjs/common';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { OneAtTime } from 'common/decorators';
import { METRIC_ACCOUNT_BALANCE } from 'common/prometheus';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { Gauge, register } from 'prom-client';
import { ProviderService } from 'provider';
import {
  WALLET_BALANCE_UPDATE_BLOCK_RATE,
  WALLET_MIN_BALANCE,
  WALLET_PRIVATE_KEY,
} from './wallet.constants';
import {
  SignDepositDataParams,
  SignModulePauseDataParams,
  SignPauseDataParams,
  SignUnvetDataParams,
} from './wallet.interfaces';

@Injectable()
export class WalletService implements OnModuleInit {
  constructor(
    @InjectMetric(METRIC_ACCOUNT_BALANCE) private accountBalance: Gauge<string>,
    @Inject(WINSTON_MODULE_NEST_PROVIDER) private logger: LoggerService,
    @Inject(WALLET_PRIVATE_KEY) private privateKey: string,
    private providerService: ProviderService,
  ) {}

  async onModuleInit() {
    const guardianAddress = this.address;
    register.setDefaultLabels({ guardianAddress });

    try {
      await this.updateBalance();
      this.subscribeToEthereumUpdates();
    } catch (error) {
      this.logger.error(error);
    }
  }

  /**
   * Subscribes to the event of a new block appearance
   */
  public subscribeToEthereumUpdates() {
    const provider = this.providerService.provider;
    provider.on('block', async (blockNumber) => {
      if (blockNumber % WALLET_BALANCE_UPDATE_BLOCK_RATE !== 0) return;
      this.updateBalance().catch((error) => this.logger.error(error));
    });

    this.logger.log('WalletService subscribed to Ethereum events');
  }

  /**
   * Updates the guardian account balance
   */
  @OneAtTime()
  public async updateBalance() {
    const provider = this.providerService.provider;
    const balanceWei = await provider.getBalance(this.address);
    const formatted = `${formatEther(balanceWei)} ETH`;
    const isSufficient = balanceWei.gte(WALLET_MIN_BALANCE);

    this.accountBalance.set(Number(formatEther(balanceWei)));

    if (isSufficient) {
      this.logger.log('Account balance is sufficient', { balance: formatted });
    } else {
      this.logger.warn('Account balance is too low', { balance: formatted });
    }
  }

  /**
   * Wallet class inherits Signer and can sign transactions and messages
   * using a private key as a standard Externally Owned Account (EOA)
   */
  public get wallet(): Wallet {
    if (this.cachedWallet) return this.cachedWallet;

    if (!this.privateKey) {
      this.logger.warn(
        'Private key is not provided, a random address will be generated for the test run',
      );

      this.privateKey = Wallet.createRandom().privateKey;
    }

    this.cachedWallet = new Wallet(this.privateKey);
    return this.cachedWallet;
  }

  private cachedWallet: Wallet | null = null;

  /**
   * Guardian wallet address
   */
  public get address(): string {
    return this.wallet.address;
  }

  /**
   * Signs a message using a private key
   * @param message - message that is signed
   * @returns signature
   */
  public signMessage(message: string): Signature {
    return this.wallet._signingKey().signDigest(message);
  }

  /**
   * Signs a message to deposit buffered ethers
   * @param signDepositDataParams - parameters for signing deposit message
   * @param signDepositDataParams.prefix - unique prefix from the contract for this type of message
   * @param signDepositDataParams.depositRoot - current deposit root from the deposit contract
   * @param signDepositDataParams.keysOpIndex - current index of keys operations from the registry contract
   * @param signDepositDataParams.blockNumber - current block number
   * @param signDepositDataParams.blockHash - current block hash
   * @param signDepositDataParams.stakingModuleId - target module id
   * @returns signature
   */
  public async signDepositData({
    prefix,
    blockNumber,
    blockHash,
    depositRoot,
    keysOpIndex,
    stakingModuleId,
  }: SignDepositDataParams): Promise<Signature> {
    const encodedData = defaultAbiCoder.encode(
      ['bytes32', 'uint256', 'bytes32', 'bytes32', 'uint256', 'uint256'],
      [
        prefix,
        blockNumber,
        blockHash,
        depositRoot,
        stakingModuleId,
        keysOpIndex,
      ],
    );

    const messageHash = keccak256(encodedData);
    return await this.signMessage(messageHash);
  }

  /**
   * Signs a message to pause deposits
   * @param signPauseDataParams - parameters for signing pause message
   * @param signPauseDataParams.prefix - unique prefix from the contract for this type of message
   * @param signPauseDataParams.blockNumber - block number that is signed
   * @returns signature
   */
  public async signPauseDataV3({
    prefix,
    blockNumber,
  }: SignPauseDataParams): Promise<Signature> {
    const encodedData = defaultAbiCoder.encode(
      ['bytes32', 'uint256'],
      [prefix, blockNumber],
    );

    const messageHash = keccak256(encodedData);
    return this.signMessage(messageHash);
  }

  /**
   * Signs a message to pause deposits
   * @param signPauseDataParams - parameters for signing pause message
   * @param signPauseDataParams.prefix - unique prefix from the contract for this type of message
   * @param signPauseDataParams.blockNumber - block number that is signed
   * @param signPauseDataParams.stakingModuleId - target staking module id
   * @returns signature
   */
  public async signPauseDataV2({
    prefix,
    blockNumber,
    stakingModuleId,
  }: SignModulePauseDataParams): Promise<Signature> {
    const encodedData = defaultAbiCoder.encode(
      ['bytes32', 'uint256', 'uint256'],
      [prefix, blockNumber, stakingModuleId],
    );

    const messageHash = keccak256(encodedData);
    return this.signMessage(messageHash);
  }

  /**
   * Sign a message to unvet signing keys
   * @param signUnvetDataParams - parameters for signing unvet message
   * @param signUnvetDataParams.prefix - unique prefix from the contract for this type of message
   * @param signUnvetDataParams.blockNumber - block number that is signed
   * @param signUnvetDataParams.blockHash - current block hash
   * @param signUnvetDataParams.nonce - current index of keys operations from the registry contract
   * @param signUnvetDataParams.stakingModuleId - target staking module id
   * @param signDepositDataParams.operatorIds - list of operators ids for unvetting
   * @param signDepositDataParams.vettedKeysByOperator - list of new values for vetted validators amount for operator
   * @returns
   */
  public async signUnvetData({
    prefix,
    blockNumber,
    blockHash,
    nonce,
    stakingModuleId,
    operatorIds,
    vettedKeysByOperator,
  }: SignUnvetDataParams): Promise<Signature> {
    const encodedData = defaultAbiCoder.encode(
      ['bytes32', 'uint256', 'bytes32', 'uint256', 'uint256', 'bytes', 'bytes'],
      [
        prefix,
        blockNumber,
        blockHash,
        stakingModuleId,
        nonce,
        operatorIds,
        vettedKeysByOperator,
      ],
    );

    const messageHash = keccak256(encodedData);
    return this.signMessage(messageHash);
  }
}
