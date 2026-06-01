"""Canonical list of U.S. states + DC for the dashboard.

Each entry carries:
- `slug`: URL-safe lowercase-hyphenated name (matches Bankrate's URL pattern
  and used as the React route `/state/:slug`).
- `postal`: 2-letter postal code (used for HMDA filter URLs).
- `fips`: 2-digit state FIPS code (used to filter HMDA LAR rows by `state_code`).
- `name`: human-readable display name.
"""

STATES: list[dict] = [
    {"slug": "alabama", "postal": "AL", "fips": "01", "name": "Alabama"},
    {"slug": "alaska", "postal": "AK", "fips": "02", "name": "Alaska"},
    {"slug": "arizona", "postal": "AZ", "fips": "04", "name": "Arizona"},
    {"slug": "arkansas", "postal": "AR", "fips": "05", "name": "Arkansas"},
    {"slug": "california", "postal": "CA", "fips": "06", "name": "California"},
    {"slug": "colorado", "postal": "CO", "fips": "08", "name": "Colorado"},
    {"slug": "connecticut", "postal": "CT", "fips": "09", "name": "Connecticut"},
    {"slug": "delaware", "postal": "DE", "fips": "10", "name": "Delaware"},
    {"slug": "district-of-columbia", "postal": "DC", "fips": "11", "name": "District of Columbia"},
    {"slug": "florida", "postal": "FL", "fips": "12", "name": "Florida"},
    {"slug": "georgia", "postal": "GA", "fips": "13", "name": "Georgia"},
    {"slug": "hawaii", "postal": "HI", "fips": "15", "name": "Hawaii"},
    {"slug": "idaho", "postal": "ID", "fips": "16", "name": "Idaho"},
    {"slug": "illinois", "postal": "IL", "fips": "17", "name": "Illinois"},
    {"slug": "indiana", "postal": "IN", "fips": "18", "name": "Indiana"},
    {"slug": "iowa", "postal": "IA", "fips": "19", "name": "Iowa"},
    {"slug": "kansas", "postal": "KS", "fips": "20", "name": "Kansas"},
    {"slug": "kentucky", "postal": "KY", "fips": "21", "name": "Kentucky"},
    {"slug": "louisiana", "postal": "LA", "fips": "22", "name": "Louisiana"},
    {"slug": "maine", "postal": "ME", "fips": "23", "name": "Maine"},
    {"slug": "maryland", "postal": "MD", "fips": "24", "name": "Maryland"},
    {"slug": "massachusetts", "postal": "MA", "fips": "25", "name": "Massachusetts"},
    {"slug": "michigan", "postal": "MI", "fips": "26", "name": "Michigan"},
    {"slug": "minnesota", "postal": "MN", "fips": "27", "name": "Minnesota"},
    {"slug": "mississippi", "postal": "MS", "fips": "28", "name": "Mississippi"},
    {"slug": "missouri", "postal": "MO", "fips": "29", "name": "Missouri"},
    {"slug": "montana", "postal": "MT", "fips": "30", "name": "Montana"},
    {"slug": "nebraska", "postal": "NE", "fips": "31", "name": "Nebraska"},
    {"slug": "nevada", "postal": "NV", "fips": "32", "name": "Nevada"},
    {"slug": "new-hampshire", "postal": "NH", "fips": "33", "name": "New Hampshire"},
    {"slug": "new-jersey", "postal": "NJ", "fips": "34", "name": "New Jersey"},
    {"slug": "new-mexico", "postal": "NM", "fips": "35", "name": "New Mexico"},
    {"slug": "new-york", "postal": "NY", "fips": "36", "name": "New York"},
    {"slug": "north-carolina", "postal": "NC", "fips": "37", "name": "North Carolina"},
    {"slug": "north-dakota", "postal": "ND", "fips": "38", "name": "North Dakota"},
    {"slug": "ohio", "postal": "OH", "fips": "39", "name": "Ohio"},
    {"slug": "oklahoma", "postal": "OK", "fips": "40", "name": "Oklahoma"},
    {"slug": "oregon", "postal": "OR", "fips": "41", "name": "Oregon"},
    {"slug": "pennsylvania", "postal": "PA", "fips": "42", "name": "Pennsylvania"},
    {"slug": "rhode-island", "postal": "RI", "fips": "44", "name": "Rhode Island"},
    {"slug": "south-carolina", "postal": "SC", "fips": "45", "name": "South Carolina"},
    {"slug": "south-dakota", "postal": "SD", "fips": "46", "name": "South Dakota"},
    {"slug": "tennessee", "postal": "TN", "fips": "47", "name": "Tennessee"},
    {"slug": "texas", "postal": "TX", "fips": "48", "name": "Texas"},
    {"slug": "utah", "postal": "UT", "fips": "49", "name": "Utah"},
    {"slug": "vermont", "postal": "VT", "fips": "50", "name": "Vermont"},
    {"slug": "virginia", "postal": "VA", "fips": "51", "name": "Virginia"},
    {"slug": "washington", "postal": "WA", "fips": "53", "name": "Washington"},
    {"slug": "west-virginia", "postal": "WV", "fips": "54", "name": "West Virginia"},
    {"slug": "wisconsin", "postal": "WI", "fips": "55", "name": "Wisconsin"},
    {"slug": "wyoming", "postal": "WY", "fips": "56", "name": "Wyoming"},
]


def by_slug(slug: str) -> dict:
    for s in STATES:
        if s["slug"] == slug:
            return s
    raise KeyError(f"Unknown state slug: {slug}")


def by_postal(postal: str) -> dict:
    p = postal.upper()
    for s in STATES:
        if s["postal"] == p:
            return s
    raise KeyError(f"Unknown postal code: {postal}")


if __name__ == "__main__":
    print(f"{len(STATES)} states + DC")
    for s in STATES[:5]:
        print(f"  {s}")
