/**
 * Raw shapes returned by the Trafikinfo API (JSON, v2 endpoint).
 * Every field is optional: the API omits fields that have no value.
 *
 * Field names follow Trafikverket's published XSD schemas (TrainAnnouncement 2.0, OperativeEvent 1.0,
 * TrainStation 1.5, Situation 1.6, WeatherObservation 2.1).
 */

export interface RawGeometry {
  SWEREF99TM?: string;
  WGS84?: string;
}

export interface RawMeasured {
  Value?: number;
  Origin?: string;
}

export interface RawCodeDescription {
  Code?: string;
  Description?: string;
}

export interface RawLocationRef {
  LocationName?: string;
  Priority?: number;
  Order?: number;
}

export interface RawStation {
  LocationSignature?: string;
  AdvertisedLocationName?: string;
  AdvertisedShortLocationName?: string;
  OfficialLocationName?: string;
  CountyNo?: number[];
  Geometry?: RawGeometry;
}

export interface RawTrainAnnouncement {
  ActivityType?: string;
  Advertised?: boolean;
  AdvertisedTimeAtLocation?: string;
  AdvertisedTrainIdent?: string;
  Canceled?: boolean;
  Deviation?: RawCodeDescription[];
  EstimatedTimeAtLocation?: string;
  EstimatedTimeIsPreliminary?: boolean;
  FromLocation?: RawLocationRef[];
  InformationOwner?: string;
  LocationSignature?: string;
  Operator?: string;
  OtherInformation?: RawCodeDescription[];
  ProductInformation?: RawCodeDescription[];
  TimeAtLocation?: string;
  ToLocation?: RawLocationRef[];
  TrackAtLocation?: string;
  TypeOfTraffic?: RawCodeDescription[];
}

export interface RawEventLocation {
  Signature?: string;
  LocationIncluded?: boolean;
}

export interface RawOperativeEvent {
  OperativeEventId?: string;
  CountyNo?: number[];
  EventType?: { Description?: string; EventTypeCode?: string };
  /** 1 = ongoing, 0 = ended. */
  EventState?: number;
  StartDateTime?: string;
  EndDateTime?: string;
  ModifiedDateTime?: string;
  EventSection?: Array<{ FromLocation?: RawEventLocation; ToLocation?: RawEventLocation; ViaLocation?: RawEventLocation }>;
  TrafficImpact?: Array<{
    Id?: string;
    StartDateTime?: string;
    EndDateTime?: string;
    ModifiedDateTime?: string;
    PublicMessage?: { Header?: string; Description?: string; StartDateTime?: string; EndDateTime?: string; ModifiedDateTime?: string };
    SelectedSection?: Array<{
      SectionLocation?: Array<{ Signature?: string; Affected?: boolean; LocationOrder?: number }>;
    }>;
  }>;
}

export interface RawDeviation {
  Id?: string;
  Header?: string;
  Message?: string;
  MessageType?: string;
  MessageCode?: string;
  SeverityCode?: number;
  SeverityText?: string;
  StartTime?: string;
  EndTime?: string;
  ValidUntilFurtherNotice?: boolean;
  RoadNumber?: string;
  RoadName?: string;
  LocationDescriptor?: string;
  PositionalDescription?: string;
  TrafficRestrictionType?: string;
  TemporaryLimit?: string;
  NumberOfLanesRestricted?: number;
  AffectedDirection?: string;
  CountyNo?: number[];
  CreationTime?: string;
  WebLink?: string;
  Geometry?: { Point?: RawGeometry; Line?: RawGeometry };
}

export interface RawSituation {
  Id?: string;
  PublicationTime?: string;
  ModifiedTime?: string;
  Deviation?: RawDeviation[];
}

export interface RawWeatherObservation {
  Id?: string;
  Sample?: string;
  Measurepoint?: { Id?: number; Name?: string; Geometry?: RawGeometry };
  Air?: {
    Temperature?: RawMeasured;
    RelativeHumidity?: RawMeasured;
    Dewpoint?: RawMeasured;
    VisibleDistance?: RawMeasured;
  };
  Wind?: Array<{ Direction?: RawMeasured; Speed?: RawMeasured }>;
  Surface?: {
    Temperature?: RawMeasured;
    Grip?: RawMeasured;
    Ice?: boolean;
    Snow?: boolean;
    Water?: boolean;
    IceDepth?: RawMeasured;
    WaterDepth?: RawMeasured;
  };
  Aggregated10minutes?: {
    Precipitation?: { Rain?: boolean; Snow?: boolean; TotalWaterEquivalent?: RawMeasured };
    Wind?: { SpeedAverage?: RawMeasured; SpeedMax?: RawMeasured };
  };
  Weather?: { Precipitation?: unknown };
}

/* ---------- Processed output types ---------- */

export interface Station {
  signature: string;
  name: string;
  shortName?: string;
  officialName?: string;
  counties: number[];
  latitude?: number;
  longitude?: number;
}

export interface TrainAnnouncement {
  train?: string;
  direction?: 'departure' | 'arrival';
  operator?: string;
  product?: string;
  trafficType?: string;
  from: string[];
  to: string[];
  track?: string;
  advertisedTime?: string;
  estimatedTime?: string;
  estimatedTimeIsPreliminary?: boolean;
  actualTime?: string;
  delayMinutes?: number;
  canceled: boolean;
  deviations: string[];
  otherInformation: string[];
}

export interface TrainMessage {
  eventId?: string;
  eventType?: string;
  header?: string;
  description?: string;
  active: boolean;
  startTime?: string;
  endTime?: string;
  expectedEndTime?: string;
  lastUpdated?: string;
  counties: number[];
  affectedLocations: string[];
  fromLocations: string[];
  toLocations: string[];
}

export interface RoadSituation {
  id?: string;
  situationId?: string;
  header?: string;
  message?: string;
  messageType?: string;
  messageCode?: string;
  severity?: string;
  severityCode?: number;
  roadNumber?: string;
  roadName?: string;
  locationDescriptor?: string;
  positionalDescription?: string;
  trafficRestriction?: string;
  temporaryLimit?: string;
  lanesRestricted?: number;
  affectedDirection?: string;
  startTime?: string;
  endTime?: string;
  validUntilFurtherNotice?: boolean;
  counties: number[];
  point?: { latitude: number; longitude: number };
  lineWgs84?: string;
  distanceKm?: number;
  webLink?: string;
}

export interface RoadWeatherStation {
  id?: number;
  name?: string;
  latitude?: number;
  longitude?: number;
  distanceKm?: number;
  sampleTime?: string;
  airTemperatureC?: number;
  humidityPercent?: number;
  dewpointC?: number;
  visibilityMeters?: number;
  wind: Array<{ directionDegrees?: number; speedMs?: number }>;
  surface?: {
    temperatureC?: number;
    grip?: number;
    ice?: boolean;
    snow?: boolean;
    water?: boolean;
    iceDepthMm?: number;
    waterDepthMm?: number;
  };
  last10min?: {
    rain?: boolean;
    snow?: boolean;
    precipitationMm?: number;
    windAverageMs?: number;
    windMaxMs?: number;
  };
  precipitationType?: unknown;
}
