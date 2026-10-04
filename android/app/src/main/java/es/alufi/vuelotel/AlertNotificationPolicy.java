package es.alufi.vuelotel;

/** Pure cursor/session rules shared by the background adapter and JVM tests. */
final class AlertNotificationPolicy {
    static boolean current(String expected, String actual, boolean enabled) {
        return enabled && expected != null && !expected.isEmpty() && expected.equals(actual);
    }
    static boolean eligible(long id, long cursor, String direction, double oldPrice, double price) {
        return id > cursor && "down".equals(direction) && Double.isFinite(oldPrice)
                && Double.isFinite(price) && oldPrice > 0 && price > 0 && price < oldPrice;
    }
    static long nextCursor(long previous, long lastReceived, long newest, boolean hasMore) {
        if (previous < 0 || lastReceived < previous || newest < lastReceived) throw new IllegalArgumentException("Invalid cursor");
        if (hasMore && lastReceived == previous) throw new IllegalArgumentException("Unchanged page");
        return hasMore ? lastReceived : newest;
    }
}
