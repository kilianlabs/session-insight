# MMDB test fixture

`GeoLite2-City-Test.mmdb` contains synthetic example data from
[MaxMind-DB](https://github.com/maxmind/MaxMind-DB/tree/9e31e7f23a31ffc2a29c2340f927e281be13ec24/test-data).
It is not a production geolocation database. The upstream MIT and Apache 2.0
licenses are included alongside it.

Tests set the clock relative to the fixture's build date so database expiry
checks remain deterministic.
