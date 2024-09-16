import { Inject, Injectable, LoggerService } from '@nestjs/common';
import { performance } from 'perf_hooks';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { ProviderService } from 'provider';
import {
  DEPOSIT_EVENTS_STEP,
  DEPOSIT_REGISTRY_FINALIZED_TAG,
} from './deposits-registry.constants';
import {
  VerifiedDepositEventsCache,
  VerifiedDepositedEventGroup,
  VerifiedDepositEvent,
} from './interfaces';
import { RepositoryService } from 'contracts/repository';
import { BlockTag } from 'provider';
import { DepositsRegistryStoreService } from './store';
import { DepositsRegistryFetcherService } from './fetcher/fetcher.service';
import { DepositRegistrySanityCheckerService } from './sanity-checker/sanity-checker.service';
import { toHexString } from './crypto';

@Injectable()
export class DepositRegistryService {
  constructor(
    @Inject(WINSTON_MODULE_NEST_PROVIDER) private logger: LoggerService,
    private providerService: ProviderService,
    private repositoryService: RepositoryService,

    private sanityChecker: DepositRegistrySanityCheckerService,
    private fetcher: DepositsRegistryFetcherService,
    private store: DepositsRegistryStoreService,

    @Inject(DEPOSIT_REGISTRY_FINALIZED_TAG) private finalizedTag: string,
  ) {}

  public async handleNewBlock(): Promise<void> {
    await this.updateEventsCache();
  }

  public async initialize() {
    await this.store.initialize();
    const cachedEvents = await this.store.getEventsCache();
    await this.sanityChecker.initialize(cachedEvents);

    await this.updateEventsCache();
  }

  /**
   * Gets node operators data from cache
   * @returns event group
   */
  public async getCachedEvents(): Promise<VerifiedDepositEventsCache> {
    const { headers, ...rest } = await this.store.getEventsCache();
    const deploymentBlock = await this.fetcher.getDeploymentBlockByNetwork();

    return {
      headers: {
        ...headers,
        startBlock: Math.max(headers.startBlock, deploymentBlock),
        endBlock: Math.max(headers.endBlock, deploymentBlock),
      },
      ...rest,
    };
  }

  /**
   * Updates the cache deposited events
   * The last N blocks are not stored, in order to avoid storing reorganized blocks
   */
  public async updateEventsCache(): Promise<void> {
    const fetchTimeStart = performance.now();

    const [finalizedBlock, initialCache] = await Promise.all([
      this.providerService.getBlock(this.finalizedTag),
      this.getCachedEvents(),
    ]);

    const { number: finalizedBlockNumber, hash: finalizedBlockHash } =
      finalizedBlock;
    const firstNotCachedBlock = initialCache.headers.endBlock + 1;

    const totalEventsCount = initialCache.data.length;
    let newEventsCount = 0;

    // check that the cache is written to a block less than or equal to the current block
    // otherwise we consider that the Ethereum node has started sending incorrect data
    const isCacheValid = this.sanityChecker.verifyCacheBlock(
      initialCache,
      finalizedBlockNumber,
    );

    if (!isCacheValid) return;

    let lastIndexedEvent: VerifiedDepositEvent | undefined = undefined;

    for (
      let block = firstNotCachedBlock;
      block <= finalizedBlockNumber;
      block += DEPOSIT_EVENTS_STEP
    ) {
      const chunkStartBlock = block;
      const chunkToBlock = Math.min(
        finalizedBlockNumber,
        block + DEPOSIT_EVENTS_STEP - 1,
      );

      const chunkEventGroup = await this.fetcher.fetchEventsFallOver(
        chunkStartBlock,
        chunkToBlock,
      );

      await this.sanityChecker.addEventGroupToIndex(
        chunkStartBlock,
        chunkToBlock,
        chunkEventGroup.events,
      );

      // Even if the cache is not valid we can't help but write it down
      // because the delay in updating the cache will eventually cause
      // the getAllDepositedEvents method to take a very long time to process, as changes
      // will be accumulated and not processed.
      await this.store.insertEventsCacheBatch({
        headers: {
          ...initialCache.headers,
          endBlock: chunkEventGroup.endBlock,
        },
        data: chunkEventGroup.events,
      });

      newEventsCount += chunkEventGroup.events.length;

      const lastEventFromGroup =
        chunkEventGroup.events[chunkEventGroup.events.length - 1];

      if (lastEventFromGroup) lastIndexedEvent = lastEventFromGroup;

      this.logger.log('Historical events are fetched', {
        finalizedBlockNumber,
        startBlock: chunkStartBlock,
        endBlock: chunkToBlock,
      });
    }

    const fetchTimeEnd = performance.now();
    const fetchTime = Math.ceil(fetchTimeEnd - fetchTimeStart) / 1000;

    const isRootValid = await this.sanityChecker.verifyUpdatedEvents(
      finalizedBlockHash,
    );

    // Store the last event from the list of updated events separately
    // Unfortunately, we cannot validate each event individually upon insertion
    // because this would require an archival node
    if (isRootValid && lastIndexedEvent) {
      await this.store.insertLastValidEvent(lastIndexedEvent);
    }

    if (!isRootValid) {
      this.logger.error('Integrity check failed on block', {
        finalizedBlock,
        finalizedBlockHash,
      });
    }

    this.logger.log('Deposit events cache is updated', {
      newEventsCount,
      totalEventsCount: totalEventsCount + newEventsCount,
      fetchTime,
    });
  }

  /**
   * Returns all deposited events based on cache and fresh data
   */
  public async getAllDepositedEvents(
    blockNumber: number,
    blockHash: string,
  ): Promise<VerifiedDepositedEventGroup> {
    const endBlock = blockNumber;
    const cachedEvents = await this.getCachedEvents();

    const isCacheValid = this.sanityChecker.verifyCacheBlock(
      cachedEvents,
      blockNumber,
    );

    if (!isCacheValid) {
      return {
        events: cachedEvents.data,
        startBlock: cachedEvents.headers.startBlock,
        endBlock: cachedEvents.headers.endBlock,
        isValid: false,
      };
    }

    const firstNotCachedBlock = cachedEvents.headers.endBlock + 1;
    const freshEventGroup = await this.fetcher.fetchEventsFallOver(
      firstNotCachedBlock,
      endBlock,
    );
    const freshEvents = freshEventGroup.events;
    const lastEvent = freshEvents[freshEvents.length - 1];
    const lastEventBlockHash = lastEvent?.blockHash;

    const isValid = await this.sanityChecker.verifyFreshEvents(
      blockHash,
      freshEvents,
    );

    if (!isValid) {
      const { lastValidEvent } = cachedEvents;
      this.logger.warn('Integrity check failed on block', {
        currentBlockNumber: blockNumber,
        currentBlockHash: blockHash,
        lastValidBlockNumber: lastValidEvent?.blockNumber,
        lastValidBlockHash: lastValidEvent?.blockHash,
        lastValidEventIndex: lastValidEvent?.index,
        lastValidEventDepositDataRoot: lastValidEvent?.depositDataRoot
          ? toHexString(lastValidEvent?.depositDataRoot)
          : '',
        lastValidEventDepositCount: lastValidEvent?.depositCount,
      });
    }

    this.logger.debug?.('Fresh deposit events are fetched', {
      events: freshEvents.length,
      startBlock: firstNotCachedBlock,
      endBlock,
      blockHash,
      lastEventBlockHash,
    });

    const mergedEvents = cachedEvents.data.concat(freshEvents);

    return {
      events: mergedEvents,
      startBlock: cachedEvents.headers.startBlock,
      endBlock,
      isValid,
    };
  }

  /**
   * Returns a deposit root
   */
  public async getDepositRoot(blockTag?: BlockTag): Promise<string> {
    const contract = await this.repositoryService.getCachedDepositContract();
    const depositRoot = await contract.get_deposit_root({
      blockTag: blockTag as any,
    });

    return depositRoot;
  }
}
