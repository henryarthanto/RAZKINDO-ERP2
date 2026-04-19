// Bluetooth Web API type declarations
interface BluetoothDevice extends EventTarget {
  id: string;
  name?: string;
  gatt?: BluetoothRemoteGATTServer;
}

interface BluetoothRemoteGATTServer extends EventTarget {
  connected: boolean;
  connect(): Promise<BluetoothRemoteGATTServer>;
  disconnect(): void;
  getPrimaryService(service: string): Promise<BluetoothRemoteGATTService>;
  getPrimaryServices(): Promise<BluetoothRemoteGATTService[]>;
}

interface BluetoothRemoteGATTService extends EventTarget {
  uuid: string;
  getCharacteristic(characteristic: string): Promise<BluetoothRemoteGATTCharacteristic>;
  getCharacteristics(): Promise<BluetoothRemoteGATTCharacteristic[]>;
}

interface BluetoothRemoteGATTCharacteristic extends EventTarget {
  uuid: string;
  value: DataView | null;
  properties: BluetoothRemoteGATTCharacteristicProperties;
  writeValue(data: BufferSource): Promise<void>;
  writeValueWithResponse(data: BufferSource): Promise<void>;
  writeValueWithoutResponse(data: BufferSource): Promise<void>;
}

interface BluetoothRemoteGATTCharacteristicProperties {
  read: boolean;
  write: boolean;
  writeWithoutResponse: boolean;
  notify: boolean;
  broadcast: boolean;
  authenticatedSignedWrites: boolean;
}

interface BluetoothScanFilter {
  services?: string[];
  name?: string;
  namePrefix?: string;
}

interface BluetoothRequestDeviceOptions {
  filters?: BluetoothScanFilter[];
  optionalServices?: string[];
  acceptAllDevices?: boolean;
}

interface Navigator {
  bluetooth?: {
    requestDevice(options: BluetoothRequestDeviceOptions): Promise<BluetoothDevice>;
    getAvailability(): Promise<boolean>;
  };
}
