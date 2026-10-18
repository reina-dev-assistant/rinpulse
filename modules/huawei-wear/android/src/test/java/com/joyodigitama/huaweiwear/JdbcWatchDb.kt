package com.joyodigitama.huaweiwear

import java.sql.Connection
import java.sql.PreparedStatement

/** [WatchDb] on a JDBC SQLite connection, so the store flows run on the JVM against the real schema. */
internal class JdbcWatchDb(private val connection: Connection) : WatchDb {
  private fun prepare(sql: String, args: Array<out Any?>): PreparedStatement =
    connection.prepareStatement(sql).also { statement -> args.forEachIndexed { i, value -> statement.setObject(i + 1, value) } }

  override fun query(sql: String, vararg args: Any?): List<List<Any?>> =
    prepare(sql, args).use { statement ->
      statement.executeQuery().use { rs ->
        val columns = rs.metaData.columnCount
        val rows = ArrayList<List<Any?>>()
        while (rs.next()) {
          rows.add(
            List(columns) {
              when (val value = rs.getObject(it + 1)) {
                is Int -> value.toLong()
                is Float -> value.toDouble()
                else -> value
              }
            },
          )
        }
        rows
      }
    }

  override fun exec(sql: String, vararg args: Any?) {
    prepare(sql, args).use { it.executeUpdate() }
  }

  override fun insertPoints(workoutId: Long, points: List<WorkoutPoint>) {
    for (p in points) {
      exec(WatchSql.INSERT_WORKOUT_POINT, workoutId, p.ts, p.lat, p.lon, p.alt, p.hr, p.speed, p.cadence, p.stride, p.power)
    }
  }

  override fun <T> transaction(block: () -> T): T {
    connection.autoCommit = false
    try {
      val result = block()
      connection.commit()
      return result
    } catch (t: Throwable) {
      connection.rollback()
      throw t
    } finally {
      connection.autoCommit = true
    }
  }
}
