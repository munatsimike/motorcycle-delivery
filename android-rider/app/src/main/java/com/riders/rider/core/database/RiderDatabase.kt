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

@Entity(tableName = "delivery_snapshot", primaryKeys = ["owner", "kind"])
data class DeliverySnapshotEntity(val owner: String, val kind: String, val savedAt: Long, val ciphertext: ByteArray)

@Dao
interface DeliverySnapshotDao {
    @Query("SELECT * FROM delivery_snapshot WHERE owner = :owner AND kind = :kind")
    suspend fun read(owner: String, kind: String): DeliverySnapshotEntity?
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun write(row: DeliverySnapshotEntity)
    @Query("DELETE FROM delivery_snapshot WHERE owner != :owner")
    suspend fun purgeOthers(owner: String)
    @Query("DELETE FROM delivery_snapshot")
    suspend fun clear()
}

val DELIVERY_CACHE_MIGRATION = object : androidx.room.migration.Migration(1, 2) {
    override fun migrate(db: androidx.sqlite.db.SupportSQLiteDatabase) {
        db.execSQL("CREATE TABLE IF NOT EXISTS delivery_snapshot (owner TEXT NOT NULL, kind TEXT NOT NULL, savedAt INTEGER NOT NULL, ciphertext BLOB NOT NULL, PRIMARY KEY(owner, kind))")
    }
}

@Database(entities = [OnboardingEntity::class, OfferEntity::class, DeliverySnapshotEntity::class], version = 2, exportSchema = true)
abstract class RiderDatabase : RoomDatabase() {
    abstract fun deliverySnapshotDao(): DeliverySnapshotDao
    abstract fun onboardingDao(): OnboardingDao
    abstract fun offerDao(): OfferDao
}
