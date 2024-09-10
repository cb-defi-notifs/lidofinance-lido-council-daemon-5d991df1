import { Module } from '@nestjs/common';
import { DepositModule } from 'contracts/deposit';
import { SecurityModule } from 'contracts/security';
import { MessagesModule } from 'messages';
import { GuardianService } from './guardian.service';
import { ScheduleModule } from 'common/schedule';
import { BlockGuardModule } from './block-guard/block-guard.module';
import { StakingModuleGuardModule } from './staking-module-guard';
import { GuardianMessageModule } from './guardian-message';
import { GuardianMetricsModule } from './guardian-metrics';
import { KeysApiModule } from 'keys-api/keys-api.module';
import { SigningKeyEventsCacheModule } from 'contracts/signing-key-events-cache';
import { UnvettingModule } from './unvetting/unvetting.module';
import { StakingModuleDataCollectorModule } from 'staking-module-data-collector';
import { StakingRouterModule } from 'contracts/staking-router';

@Module({
  imports: [
    DepositModule,
    SecurityModule,
    MessagesModule,
    StakingModuleDataCollectorModule,
    ScheduleModule,
    BlockGuardModule,
    StakingModuleGuardModule,
    UnvettingModule,
    GuardianMessageModule,
    GuardianMetricsModule,
    KeysApiModule,
    SigningKeyEventsCacheModule,
    StakingRouterModule,
  ],
  providers: [GuardianService],
  exports: [GuardianService],
})
export class GuardianModule {}
