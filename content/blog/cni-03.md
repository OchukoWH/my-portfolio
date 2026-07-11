---
title: "Building a Kubernetes CNI From Scratch (Part 3): Writing a Bash CNI Plugin"
description: "In this article, we build the first working version of our Kubernetes CNI plugin using Bash. We create a Linux bridge, allocate pod IPs, create veth pairs, connect pods to the host, and return a valid CNI result to containerd."
date: "2026-07-06"
tags: "Kubernetes, CNI, Bash, Linux Networking, containerd, Platform Engineering, Cloud Native"
cover: "/blog/cni-01/image-01.png"
published: false
order: 3
series: "Building a Kubernetes CNI From Scratch"
seriesOrder: 3
---

In [Part 2](/blog/cni-02), we stepped away from Kubernetes and looked at the Linux primitives behind container networking:

- network namespaces
- cgroups
- pause containers
- shared pod networking

Now we are going to build the first real version of our CNI.

Not in Go yet.

Not with fancy libraries.

Just **Bash**.

The goal of this article is not to build a production-grade CNI. The goal is to understand what a CNI actually does when the container runtime calls it.

By the end of this article, our Bash CNI will be able to:

- create a Linux bridge on the node
- allocate an IP address for a pod
- create a veth pair
- move one end of the veth into the pod network namespace
- attach the host side to the bridge
- configure routes inside the pod
- allow pod-to-node communication
- allow node-to-pod communication
- allow pod-to-pod communication on the same node
- return a valid CNI JSON response to containerd

This is the first point in the series where Kubernetes networking stops being theory and starts becoming something we can actually touch.


## One Important Correction Before We Start

There is one detail we need to get right.

The CNI does **not** create the pod's network namespace.

The container runtime does.

In our setup, the runtime is `containerd`.

When kubelet asks containerd to create a pod sandbox, containerd creates the sandbox container, also called the pause container. That pause container owns the pod's network namespace.

After creating the namespace, containerd calls our CNI plugin and passes the namespace path through an environment variable.

That variable is:

```bash
CNI_NETNS
```

So the CNI's job is not:

> "Create a network namespace."

The CNI's job is:

> "Take this network namespace that already exists and configure networking inside it."

That means our Bash script will receive an existing namespace and then:

- create a veth pair
- move one end into the namespace
- assign the pod IP
- configure routes
- connect the pod to the host bridge

That is exactly what production CNIs do too, although they do it with much more robust code.


## How containerd Finds Our CNI

Before containerd can run our plugin, two things must exist on the node.

First, there must be a CNI config file inside:

```bash
/etc/cni/net.d/
```

For example:

```json
{
  "cniVersion": "1.0.0",
  "name": "my-cni",
  "type": "my-cni"
}
```

In the actual node, this might be saved as:

```bash
/etc/cni/net.d/10-my-cni.conf
```

The important field is:

```json
"type": "my-cni"
```

That tells containerd:

> "Look for an executable called `my-cni`."

So the second thing we need is the actual executable:

```bash
/opt/cni/bin/my-cni
```

If the config says `"type": "my-cni"` but the binary does not exist at `/opt/cni/bin/my-cni`, the runtime cannot call our plugin.

That is when you start seeing errors like:

```text
failed to find plugin "my-cni" in path [/opt/cni/bin]
```

So the relationship is:

```text
/etc/cni/net.d/10-my-cni.conf
        |
        | type: my-cni
        v
/opt/cni/bin/my-cni
```

The config file tells containerd **what plugin to run**.

The binary contains the logic that actually configures networking.


## The Bash CNI Script

Here is the full script we are working with:

```bash
#!/bin/bash
set -euo pipefail

STATE_DIR="/var/lib/my-cni"
CONFIG_FILE="/etc/my-cni/node.env"
LOG="/tmp/my-cni.log"

mkdir -p "$STATE_DIR"

exec 9>"$STATE_DIR/lock"
flock 9

source "$CONFIG_FILE"

BRIDGE="cni0"
GW="${POD_CIDR%0/24}1"
BRIDGE_CIDR="${GW}/24"

echo "$(date) CMD=${CNI_COMMAND:-} NETNS=${CNI_NETNS:-} IF=${CNI_IFNAME:-} ID=${CNI_CONTAINERID:-} POD_CIDR=${POD_CIDR:-}" >> "$LOG"

ensure_bridge() {
  ip link show "$BRIDGE" >/dev/null 2>&1 || ip link add "$BRIDGE" type bridge
  ip addr replace "$BRIDGE_CIDR" dev "$BRIDGE"
  ip link set "$BRIDGE" up
}

allocate_ip() {
  BASE="${POD_CIDR%0/24}"

  for i in $(seq 2 254); do
    if [ ! -f "$STATE_DIR/ip-$i" ]; then
      echo "$CNI_CONTAINERID" > "$STATE_DIR/ip-$i"
      echo "${BASE}${i}"
      return
    fi
  done

  echo "no available IPs" >&2
  exit 1
}

release_ip() {
  rm -f "$STATE_DIR/$CNI_CONTAINERID"
  grep -l "$CNI_CONTAINERID" "$STATE_DIR"/ip-* 2>/dev/null | xargs -r rm -f
}

cmd_add() {
  ensure_bridge

  IP="$(allocate_ip)"
  HOST_VETH="veth${CNI_CONTAINERID:0:8}"
  POD_TEMP="tmp${CNI_CONTAINERID:0:8}"
  NETNS_NAME="$(basename "$CNI_NETNS")"

  ip link del "$HOST_VETH" 2>/dev/null || true
  ip link del "$POD_TEMP" 2>/dev/null || true

  ip link add "$HOST_VETH" type veth peer name "$POD_TEMP"

  ip link set "$POD_TEMP" netns "$NETNS_NAME"
  ip netns exec "$NETNS_NAME" ip link set "$POD_TEMP" name "$CNI_IFNAME"

  ip link set "$HOST_VETH" master "$BRIDGE"
  ip link set "$HOST_VETH" up

  ip netns exec "$NETNS_NAME" ip addr replace "$IP/24" dev "$CNI_IFNAME"
  ip netns exec "$NETNS_NAME" ip link set "$CNI_IFNAME" up
  ip netns exec "$NETNS_NAME" ip link set lo up
  ip netns exec "$NETNS_NAME" ip route replace default via "$GW"

  cat > "$STATE_DIR/$CNI_CONTAINERID" <<STATE
IP=$IP
HOST_VETH=$HOST_VETH
NETNS=$CNI_NETNS
STATE

  cat <<JSON
{
  "cniVersion": "1.0.0",
  "interfaces": [
    {
      "name": "$CNI_IFNAME",
      "sandbox": "$CNI_NETNS"
    }
  ],
  "ips": [
    {
      "version": "4",
      "address": "$IP/24",
      "gateway": "$GW",
      "interface": 0
    }
  ],
  "routes": [
    {
      "dst": "0.0.0.0/0",
      "gw": "$GW"
    }
  ]
}
JSON
}

cmd_del() {
  if [ -f "$STATE_DIR/$CNI_CONTAINERID" ]; then
    source "$STATE_DIR/$CNI_CONTAINERID"
    ip link del "$HOST_VETH" 2>/dev/null || true
  fi

  release_ip
}

case "${CNI_COMMAND:-}" in
  ADD) cmd_add ;;
  DEL) cmd_del ;;
  CHECK) exit 0 ;;
  *) echo "unsupported command" >&2; exit 1 ;;
esac
```

In the next sections, we'll break it down properly.

Not just line by line, but by what each part contributes to pod networking.

## Why the CNI Config File Can Make Nodes Look Healthy

One interesting thing I noticed while testing this is that the node can become **Ready** once a CNI config file exists.

For example, if we add this file:

```json
{
  "cniVersion": "1.0.0",
  "name": "my-cni",
  "type": "my-cni"
}
```

inside:

```bash
/etc/cni/net.d/10-my-cni.conf
```

the kubelet may stop reporting:

```text
NetworkPluginNotReady
```

and the node may become healthy.

But this does **not** mean networking actually works.

This is very important.

At this point, containerd has only discovered that a CNI configuration exists.

It now knows:

```text
When a pod is created, I should call a plugin named my-cni.
```

But if this file points to a plugin that does not exist:

```bash
/opt/cni/bin/my-cni
```

or if the plugin exists but does not correctly configure networking, pods will still fail when containerd tries to create their sandbox.

So there are two separate stages:

```text
1. CNI config exists
   Node may become Ready

2. CNI plugin works correctly
   Pods can actually get networking
```

That means a node being Ready does not automatically prove your CNI works.

The real test is whether pods can be created, receive IP addresses, and communicate.


## The Shebang

The first line is:

```bash
#!/bin/bash
```

This tells Linux to execute the file using Bash.

Since our CNI plugin is just a Bash script, this line is required.

When containerd runs:

```bash
/opt/cni/bin/my-cni
```

Linux uses the shebang to know which interpreter should execute the script.

Without this, the runtime may fail to execute the plugin correctly.


## Safer Bash Defaults

Next we have:

```bash
set -euo pipefail
```

This makes the script stricter.

`set -e` means the script should exit immediately if a command fails.

`set -u` means the script should fail if we try to use an undefined variable.

`pipefail` means if any command inside a pipeline fails, the whole pipeline fails.

This is useful for a CNI because networking scripts can be dangerous.

If a command fails silently, the pod might receive a half-configured network namespace.

That is worse than failing clearly.


## State, Config and Logs

Next:

```bash
STATE_DIR="/var/lib/my-cni"
CONFIG_FILE="/etc/my-cni/node.env"
LOG="/tmp/my-cni.log"
```

Our CNI needs somewhere to store state.

That is what this directory is for:

```bash
/var/lib/my-cni
```

Inside it, we will store things like:

- allocated IP addresses
- container IDs
- host veth names

The config file is:

```bash
/etc/my-cni/node.env
```

This file contains node-specific configuration.

For example:

```bash
POD_CIDR=10.244.1.0/24
```

Each node should have its own Pod CIDR.

For example:

```text
worker-1: 10.244.1.0/24
worker-2: 10.244.2.0/24
```

That way, every node gives pods IP addresses from a different subnet.

Finally:

```bash
LOG="/tmp/my-cni.log"
```

This is where we log every call containerd makes to our CNI.

This is extremely useful while debugging.


## Creating the State Directory

```bash
mkdir -p "$STATE_DIR"
```

This creates the state directory if it does not already exist.

The `-p` flag means:

- do not fail if the directory already exists
- create parent directories if needed

So this is safe to run every time the plugin is called.


## Locking the CNI

```bash
exec 9>"$STATE_DIR/lock"
flock 9
```

This part is very important.

A node can create multiple pods at almost the same time.

If two CNI calls happen together, both could try to allocate the same IP address.

That would be bad.

So we use a lock file.

```bash
$STATE_DIR/lock
```

The `flock` command ensures only one instance of our CNI script can allocate IP addresses at a time.

This makes IP allocation safer.


## Loading the Node Config

```bash
source "$CONFIG_FILE"
```

This loads variables from:

```bash
/etc/my-cni/node.env
```

For example, if the file contains:

```bash
POD_CIDR=10.244.1.0/24
```

then after sourcing it, our script can use:

```bash
$POD_CIDR
```

This is how each node knows what pod subnet it should use.


## Bridge and Gateway Variables

```bash
BRIDGE="cni0"
GW="${POD_CIDR%0/24}1"
BRIDGE_CIDR="${GW}/24"
```

Our CNI will create a Linux bridge called:

```bash
cni0
```

Think of this bridge as a small software switch inside the node.

Every pod on this node will connect to this bridge.

The gateway IP is calculated from the node's Pod CIDR.

If:

```bash
POD_CIDR=10.244.1.0/24
```

then:

```bash
GW=10.244.1.1
```

and:

```bash
BRIDGE_CIDR=10.244.1.1/24
```

This means the bridge itself gets the first IP address in the pod subnet.

Pods will get addresses like:

```text
10.244.1.2
10.244.1.3
10.244.1.4
```

So the bridge becomes the default gateway for pods on that node.


## Logging Every CNI Call

```bash
echo "$(date) CMD=${CNI_COMMAND:-} NETNS=${CNI_NETNS:-} IF=${CNI_IFNAME:-} ID=${CNI_CONTAINERID:-} POD_CIDR=${POD_CIDR:-}" >> "$LOG"
```

Whenever containerd calls our plugin, it passes important environment variables.

Some of them are:

```bash
CNI_COMMAND
CNI_NETNS
CNI_IFNAME
CNI_CONTAINERID
```

This line logs them.

For example:

```text
CMD=ADD NETNS=/var/run/netns/cni-xxx IF=eth0 ID=abc123 POD_CIDR=10.244.1.0/24
```

This tells us:

- what command containerd asked us to run
- which network namespace we should configure
- what interface name the pod expects
- which container/pod sandbox is being configured
- which Pod CIDR this node is using

When your CNI breaks, this log file is one of the first places to check.


## Creating the Linux Bridge

Now we get to the first real networking function.

```bash
ensure_bridge() {
  ip link show "$BRIDGE" >/dev/null 2>&1 || ip link add "$BRIDGE" type bridge
  ip addr replace "$BRIDGE_CIDR" dev "$BRIDGE"
  ip link set "$BRIDGE" up
}
```

This function ensures the node has a bridge called:

```bash
cni0
```

The first line checks whether the bridge already exists:

```bash
ip link show "$BRIDGE" >/dev/null 2>&1
```

If it does not exist, we create it:

```bash
ip link add "$BRIDGE" type bridge
```

So this creates:

```bash
cni0
```

Then we assign the gateway IP to the bridge:

```bash
ip addr replace "$BRIDGE_CIDR" dev "$BRIDGE"
```

For example:

```bash
ip addr replace 10.244.1.1/24 dev cni0
```

Finally, we bring the bridge up:

```bash
ip link set "$BRIDGE" up
```

Without this, the bridge exists but cannot forward traffic.

After this function runs, the node has a software switch ready to connect pods.

Conceptually:

```text
Node

+------------------+
| cni0             |
| 10.244.1.1/24    |
+------------------+
```

## Allocating Pod IP Addresses

After the bridge exists, the next thing our CNI needs is an IP address for the pod.

That is what this function does:

```bash
allocate_ip() {
  BASE="${POD_CIDR%0/24}"

  for i in $(seq 2 254); do
    if [ ! -f "$STATE_DIR/ip-$i" ]; then
      echo "$CNI_CONTAINERID" > "$STATE_DIR/ip-$i"
      echo "${BASE}${i}"
      return
    fi
  done

  echo "no available IPs" >&2
  exit 1
}
```

If the node has this Pod CIDR:

```bash
POD_CIDR=10.244.1.0/24
```

then this line:

```bash
BASE="${POD_CIDR%0/24}"
```

turns it into:

```bash
10.244.1.
```

Then the loop checks IPs from:

```text
10.244.1.2
```

to:

```text
10.244.1.254
```

Why does it start from `2`?

Because:

```text
10.244.1.1
```

is already used by the bridge as the pod gateway.

So the first pod on this node gets:

```text
10.244.1.2
```

The second pod gets:

```text
10.244.1.3
```

and so on.

For every allocated IP, we create a small state file:

```bash
$STATE_DIR/ip-$i
```

The content of that file is the container ID.

This is not production-grade IPAM, but it is enough for learning.

A real CNI would use a proper IPAM plugin or a more reliable allocation system.


## Releasing Pod IP Addresses

When Kubernetes deletes a pod, containerd calls our CNI again.

This time, the command is:

```bash
CNI_COMMAND=DEL
```

So we need to release the IP address we previously allocated.

```bash
release_ip() {
  rm -f "$STATE_DIR/$CNI_CONTAINERID"
  grep -l "$CNI_CONTAINERID" "$STATE_DIR"/ip-* 2>/dev/null | xargs -r rm -f
}
```

This function removes two types of state.

First, it removes the container state file:

```bash
rm -f "$STATE_DIR/$CNI_CONTAINERID"
```

Then it searches for any IP allocation file containing the container ID:

```bash
grep -l "$CNI_CONTAINERID" "$STATE_DIR"/ip-* 2>/dev/null
```

and deletes it:

```bash
xargs -r rm -f
```

This means the IP address can be reused by a future pod.

Again, this is intentionally simple.

The point is to understand the lifecycle:

```text
ADD = allocate IP

DEL = release IP
```


## Handling the ADD Command

The most important part of the script is:

```bash
cmd_add() {
  ensure_bridge

  IP="$(allocate_ip)"
  HOST_VETH="veth${CNI_CONTAINERID:0:8}"
  POD_TEMP="tmp${CNI_CONTAINERID:0:8}"
  NETNS_NAME="$(basename "$CNI_NETNS")"
```

When containerd creates a pod sandbox, it calls our CNI with:

```bash
CNI_COMMAND=ADD
```

That means:

> "Please configure networking for this pod."

The first thing we do is ensure the bridge exists:

```bash
ensure_bridge
```

Then we allocate an IP:

```bash
IP="$(allocate_ip)"
```

Next we generate interface names.

```bash
HOST_VETH="veth${CNI_CONTAINERID:0:8}"
POD_TEMP="tmp${CNI_CONTAINERID:0:8}"
```

If the container ID begins with:

```text
abcdef123456...
```

then the host veth becomes:

```text
vethabcdef12
```

and the temporary pod-side veth becomes:

```text
tmpabcdef12
```

The reason we use part of the container ID is to reduce name collisions.

Linux interface names are limited in length, so we only use the first few characters.

Then:

```bash
NETNS_NAME="$(basename "$CNI_NETNS")"
```

This extracts the namespace name from the namespace path.

For example, if:

```bash
CNI_NETNS=/var/run/netns/cni-12345
```

then:

```bash
NETNS_NAME=cni-12345
```

This matters because commands like:

```bash
ip netns exec
```

usually work with namespace names.


## Cleaning Up Old Interfaces

Before creating new veth interfaces, we delete old ones if they exist.

```bash
ip link del "$HOST_VETH" 2>/dev/null || true
ip link del "$POD_TEMP" 2>/dev/null || true
```

This makes the script more forgiving during testing.

If a previous run failed halfway, it may have left behind stale interfaces.

So before creating new ones, we clean them up.

The command:

```bash
2>/dev/null || true
```

means:

> "If this interface does not exist, do not fail the entire script."

That is useful because `set -e` would normally stop the script when a command fails.


## Creating the veth Pair

Now we create the virtual Ethernet pair.

```bash
ip link add "$HOST_VETH" type veth peer name "$POD_TEMP"
```

This creates two connected virtual interfaces.

One is:

```bash
$HOST_VETH
```

The other is:

```bash
$POD_TEMP
```

Conceptually:

```text
HOST_VETH  <-------------------->  POD_TEMP
```

Whatever enters one side comes out the other.

At this moment, both interfaces still exist on the host.

Nothing has entered the pod namespace yet.


## Moving One End Into the Pod Namespace

Now we move the pod side into the pod's network namespace.

```bash
ip link set "$POD_TEMP" netns "$NETNS_NAME"
```

After this command:

```text
HOST_VETH
```

stays on the host.

```text
POD_TEMP
```

moves into the pod namespace.

Conceptually:

```text
Host namespace                    Pod namespace

HOST_VETH  <-------------------->  POD_TEMP
```

This is the core trick behind most basic container networking.

The pod gets one end of the pipe.

The host keeps the other end.


## Renaming the Pod Interface

Inside Kubernetes, pods usually expect their main network interface to be named:

```bash
eth0
```

containerd tells us the expected interface name through:

```bash
CNI_IFNAME
```

Usually:

```bash
CNI_IFNAME=eth0
```

So we rename the temporary interface:

```bash
ip netns exec "$NETNS_NAME" ip link set "$POD_TEMP" name "$CNI_IFNAME"
```

Now inside the pod namespace, the interface is no longer called:

```bash
tmpabcdef12
```

It is called:

```bash
eth0
```

So the pod sees a normal-looking network interface.


## Connecting the Host Side to the Bridge

Now we attach the host side of the veth pair to our bridge.

```bash
ip link set "$HOST_VETH" master "$BRIDGE"
```

This connects the host veth to:

```bash
cni0
```

Conceptually:

```text
Pod namespace                 Host namespace

eth0  <---- veth pair ---->  vethabc123  ---->  cni0
```

The bridge now acts like a software switch.

Every pod connected to this bridge can reach other pods on the same bridge.

Then we bring the host veth up:

```bash
ip link set "$HOST_VETH" up
```

Without this, the interface exists but cannot pass traffic.


## Assigning the Pod IP Address

Now we configure the pod-side interface.

```bash
ip netns exec "$NETNS_NAME" ip addr replace "$IP/24" dev "$CNI_IFNAME"
```

If the allocated IP was:

```bash
10.244.1.2
```

then the pod receives:

```bash
10.244.1.2/24
```

on:

```bash
eth0
```

inside its network namespace.

Then we bring the pod interface up:

```bash
ip netns exec "$NETNS_NAME" ip link set "$CNI_IFNAME" up
```

We also bring the loopback interface up:

```bash
ip netns exec "$NETNS_NAME" ip link set lo up
```

This matters because many applications expect `localhost` to work.

Inside the pod, `localhost` refers to the pod's own network namespace.


## Adding the Default Route

Finally, we add the pod's default route.

```bash
ip netns exec "$NETNS_NAME" ip route replace default via "$GW"
```

If:

```bash
GW=10.244.1.1
```

then inside the pod we add:

```text
default via 10.244.1.1
```

This means:

> "If the pod wants to reach an IP address outside its own subnet, send the packet to 10.244.1.1."

And remember:

```bash
10.244.1.1
```

is the IP address of the bridge on the host.

So the bridge becomes the pod's gateway.

This is how pod-to-node communication begins to work.

The pod sends traffic to its gateway.

The gateway is `cni0`.

The host receives the packet and decides where to route it next.

At this point, traffic inside the same node can work.

But for traffic to reach the Internet or pods on other nodes, the host must also have the correct forwarding and routing rules.

We'll test same-node pod communication first before expanding to multi-node networking in the next part of the series.

## Saving Pod State

After configuring the pod network, we save some state to disk.

```bash
cat > "$STATE_DIR/$CNI_CONTAINERID" <<STATE
IP=$IP
HOST_VETH=$HOST_VETH
NETNS=$CNI_NETNS
STATE
```

This creates a file like:

```bash
/var/lib/my-cni/<container-id>
```

Inside it, we store:

```bash
IP=10.244.1.2
HOST_VETH=vethabc12345
NETNS=/var/run/netns/cni-xxxx
```

This matters during deletion.

When Kubernetes deletes the pod, containerd calls our CNI with:

```bash
CNI_COMMAND=DEL
```

At that point, our script needs to know which veth interface belongs to the pod.

That is why we store:

```bash
HOST_VETH=$HOST_VETH
```

Without this state file, cleanup becomes much harder.


## Returning the CNI Result to containerd

After setting up the bridge, veth pair, pod IP address, and route, our plugin must return a valid CNI response.

That is what this block does:

```bash
cat <<JSON
{
  "cniVersion": "1.0.0",
  "interfaces": [
    {
      "name": "$CNI_IFNAME",
      "sandbox": "$CNI_NETNS"
    }
  ],
  "ips": [
    {
      "version": "4",
      "address": "$IP/24",
      "gateway": "$GW",
      "interface": 0
    }
  ],
  "routes": [
    {
      "dst": "0.0.0.0/0",
      "gw": "$GW"
    }
  ]
}
JSON
```

This JSON is printed to standard output.

That is important.

The CNI plugin does not call containerd directly.

It simply writes the result to stdout, and containerd reads it.

The response tells containerd:

- the CNI spec version
- the interface created inside the pod
- the pod IP address
- the pod gateway
- the default route

For example, if the pod gets:

```bash
10.244.1.2/24
```

and the bridge gateway is:

```bash
10.244.1.1
```

then containerd receives a result saying:

```text
Pod IP: 10.244.1.2/24
Gateway: 10.244.1.1
Default route: 0.0.0.0/0 via 10.244.1.1
```

Kubelet can then report the pod IP back to the Kubernetes API Server.

That is how `kubectl get pods -o wide` eventually shows a pod IP.


## Handling the DEL Command

When Kubernetes deletes a pod, containerd calls the CNI again.

This time the command is:

```bash
CNI_COMMAND=DEL
```

Our script handles that here:

```bash
cmd_del() {
  if [ -f "$STATE_DIR/$CNI_CONTAINERID" ]; then
    source "$STATE_DIR/$CNI_CONTAINERID"
    ip link del "$HOST_VETH" 2>/dev/null || true
  fi

  release_ip
}
```

First, we check if the container state file exists:

```bash
if [ -f "$STATE_DIR/$CNI_CONTAINERID" ]; then
```

If it exists, we load it:

```bash
source "$STATE_DIR/$CNI_CONTAINERID"
```

That gives us access to:

```bash
$HOST_VETH
```

Then we delete the host-side veth:

```bash
ip link del "$HOST_VETH" 2>/dev/null || true
```

This removes the veth pair.

Because veth devices come in pairs, deleting the host side also removes the peer side inside the pod namespace.

Finally, we release the IP address:

```bash
release_ip
```

So deletion does two important things:

- removes the pod's veth interface
- frees the pod IP for reuse

This is why CNIs must implement cleanup.

If they don't, nodes slowly accumulate stale interfaces, routes, IP allocations, and broken state.


## Handling CHECK

The script also supports:

```bash
CHECK) exit 0 ;;
```

The `CHECK` command is used by runtimes to verify whether the network is still configured as expected.

Our implementation simply exits successfully.

This is not good enough for production.

A real CNI should check that:

- the bridge exists
- the pod interface exists
- the IP address is correct
- the route exists
- the host veth is connected to the bridge

But for this learning implementation, returning success is fine.


## Routing Commands From containerd

Finally, the script decides which function to run based on `CNI_COMMAND`.

```bash
case "${CNI_COMMAND:-}" in
  ADD) cmd_add ;;
  DEL) cmd_del ;;
  CHECK) exit 0 ;;
  *) echo "unsupported command" >&2; exit 1 ;;
esac
```

If containerd calls:

```bash
CNI_COMMAND=ADD
```

we configure networking.

If it calls:

```bash
CNI_COMMAND=DEL
```

we clean up networking.

If it calls:

```bash
CNI_COMMAND=CHECK
```

we return success.

Anything else fails.

This is the command lifecycle of a CNI plugin.


# Testing the CNI

At this point, our Bash script should exist at:

```bash
/opt/cni/bin/my-cni
```

It should be executable:

```bash
sudo chmod +x /opt/cni/bin/my-cni
```

Our config should exist at:

```bash
/etc/cni/net.d/10-my-cni.conf
```

with:

```json
{
  "cniVersion": "1.0.0",
  "name": "my-cni",
  "type": "my-cni"
}
```

And our node config should exist at:

```bash
/etc/my-cni/node.env
```

For example, on `worker-1`:

```bash
POD_CIDR=10.244.1.0/24
```

On `worker-2`:

```bash
POD_CIDR=10.244.2.0/24
```

Now let's create a test pod.

```bash
kubectl run nginx-1 --image=nginx --restart=Never
```

Then check it:

```bash
kubectl get pods -o wide
```

You should see something like:

```text
NAME      READY   STATUS    IP
nginx-1   1/1     Running   10.244.1.2
```

That pod IP came from our Bash CNI.


## Testing Node to Pod Communication

From the node where the pod is running, try:

```bash
curl http://10.244.1.2
```

If nginx is running correctly, you should get the nginx default page.

Why does this work?

Because the node has a bridge:

```bash
cni0
```

with an IP like:

```bash
10.244.1.1/24
```

The pod has:

```bash
10.244.1.2/24
```

Both are in the same subnet.

The pod's `eth0` is connected to the bridge through a veth pair.

So traffic flows like this:

```text
Node
  |
  | curl 10.244.1.2
  v
cni0
  |
host veth
  |
pod eth0
  |
nginx
```

That is host-to-pod communication.


## Testing Pod to Node Communication

Now enter the pod:

```bash
kubectl exec -it nginx-1 -- sh
```

Inside the pod, try pinging the bridge gateway:

```bash
ping 10.244.1.1
```

This should work.

Why?

Because the pod's default gateway is:

```bash
10.244.1.1
```

That gateway is the bridge on the host.

So traffic flows like this:

```text
Pod
  |
  | ping 10.244.1.1
  v
eth0
  |
veth pair
  |
cni0
  |
Host
```

That is pod-to-node communication.


## Testing Pod to Pod Communication on the Same Node

Now create another pod on the same node.

For a simple test, you can schedule two pods on the same worker node using `nodeName`.

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: nginx-2
spec:
  nodeName: worker-1
  containers:
  - name: nginx
    image: nginx
```

Apply it:

```bash
kubectl apply -f nginx-2.yaml
```

Now check both pods:

```bash
kubectl get pods -o wide
```

Example:

```text
NAME      READY   STATUS    IP            NODE
nginx-1   1/1     Running   10.244.1.2    worker-1
nginx-2   1/1     Running   10.244.1.3    worker-1
```

Now enter one pod:

```bash
kubectl exec -it nginx-1 -- sh
```

From inside `nginx-1`, try reaching `nginx-2`:

```bash
curl http://10.244.1.3
```

This should work.

Why?

Both pods are connected to the same Linux bridge.

Conceptually:

```text
nginx-1 eth0
     |
     | veth pair
     |
    cni0
     |
     | veth pair
     |
nginx-2 eth0
```

The bridge behaves like a software switch.

Since both pod IPs are in the same subnet:

```text
10.244.1.0/24
```

Linux can deliver traffic between them locally.

No overlay network is needed.

No VXLAN is needed.

No routing across nodes is needed.

Same-node pod-to-pod communication is just bridge networking.


## What Works Now?

At this stage, our CNI supports networking **inside one node**.

We can do:

```text
Node -> Pod

Pod -> Node

Pod -> Pod on the same node
```

That is already a big deal.

We have built the first working foundation of a CNI.

But there are still things that do not work yet.

For example:

```text
Pod on worker-1 -> Pod on worker-2
```

will not work yet.

Why?

Because `worker-1` does not know how to reach:

```text
10.244.2.0/24
```

and `worker-2` does not know how to reach:

```text
10.244.1.0/24
```

Each node only knows about its own pod subnet.

To make cross-node pod networking work, we need node-to-node routing.

That will come in the next article.


## What About Internet Access?

Our script adds this route inside the pod:

```bash
ip route replace default via "$GW"
```

That tells the pod:

```text
For everything outside my subnet, send traffic to the bridge gateway.
```

But that alone does not guarantee Internet access.

For Internet access to work, the host must also:

- allow IP forwarding
- know how to route the packet out
- usually perform NAT/masquerading

For example, the host may need:

```bash
sysctl -w net.ipv4.ip_forward=1
```

and NAT rules using `iptables` or `nftables`.

We are intentionally not solving Internet egress fully in this article because this part focuses on basic node and same-node pod networking.

But conceptually, the pod sends external traffic like this:

```text
Pod
  |
eth0
  |
veth
  |
cni0
  |
host routing table
  |
host eth0
  |
Internet
```

The default route inside the pod gets the packet to the host.

The host then needs forwarding and NAT rules to push it out to the Internet.


# What We Built

Let's step back.

Our Bash CNI now does the core work of a simple bridge-based CNI.

On `ADD`, it:

- ensures a Linux bridge exists
- assigns the bridge a gateway IP
- allocates a pod IP
- creates a veth pair
- moves one side into the pod network namespace
- renames it to `eth0`
- attaches the host side to `cni0`
- assigns the pod IP
- brings interfaces up
- adds a default route inside the pod
- returns a CNI JSON result to containerd

On `DEL`, it:

- deletes the host-side veth
- releases the allocated IP
- removes local state

That is the basic lifecycle of a CNI plugin.


# What's Coming Next?

We now have working networking on a single node.

That means:

```text
host -> pod works

pod -> host works

pod -> pod on the same node works
```

But Kubernetes clusters usually have multiple worker nodes.

In the next article, we'll solve the next problem:

> How does a pod on worker-1 reach a pod on worker-2?

To make that work, we need to teach each node about the Pod CIDRs that live on other nodes.

We'll start with manual Linux routes.

Then we'll move toward automating route distribution so that every node knows how to reach every other node's pods.

At that point, our CNI will begin to feel much closer to a real multi-node Kubernetes networking plugin.
