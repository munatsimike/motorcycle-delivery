package com.riders.rider.core.database

import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.RoomDatabase

@Entity(tableName = "onboarding_cache")
data class OnboardingEntity(
    @PrimaryKey val id: Int = 1,
    val licenceVerificationStatus: String,
    val approvalStatus: String,
    val availability: String,
    val licenceNumber: String?,
    val licenceClass: String?,
    val rejectionReason: String?,
    val verifiedMotorcycleCount: Int,
    val activeVerifiedMotorcycle: Boolean,
)

@Entity(tableName = "offer_cache")
data class OfferEntity(
    @PrimaryKey val assignmentId: String,
    val payloadJson: String,
)

@Dao
interface OnboardingDao {
    @Query("SELECT * FROM onboarding_cache WHERE id = 1")
    suspend fun read(): OnboardingEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun write(entity: OnboardingEntity)
}

@Dao
interface OfferDao {
    @Query("SELECT * FROM offer_cache")
    suspend fun readAll(): List<OfferEntity>

    @Query("DELETE FROM offer_cache")
    suspend fun clear()

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun writeAll(entities: List<OfferEntity>)
}

@Database(entities = [OnboardingEntity::class, OfferEntity::class], version = 1, exportSchema = false)
abstract class RiderDatabase : RoomDatabase() {
    abstract fun onboardingDao(): OnboardingDao
    abstract fun offerDao(): OfferDao
}
