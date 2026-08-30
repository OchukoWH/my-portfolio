# How Packets Cross Nodes in Kubernetes (Part 1)

## Understanding the Networking Fabric That Connects Every Pod

> *"A frontend Pod on Node A sends a request to a backend Pod on Node B. Somehow, the packet crosses the network without the application knowing or caring where either Pod is running. How?"*

In the previous article, we followed a packet all the way through kube-proxy.

Our application sent a request to a Service.

CoreDNS translated the Service name into a ClusterIP.

kube-proxy rewrote that virtual IP into the IP address of a real backend Pod.

Eventually, our packet looked something like this:

```text id="pkt1aa"
Source

10.244.1.5

Destination

10.244.2.14
```

If the frontend and backend Pods happened to be on the same worker node, the story ended there.

The packet crossed a Linux bridge and arrived at the backend Pod.

Simple.

But what if they aren't?

Imagine this cluster.

```text id="pkt1ab"
                 Kubernetes Cluster

┌──────────────────────────────────────────────────────┐

Worker Node A                    Worker Node B

Frontend Pod                     Backend Pod

10.244.1.5                       10.244.2.14

└──────────────────────────────────────────────────────┘
```

The frontend Pod wants to send a packet directly to:

```text id="pkt1ac"
10.244.2.14
```

But there's a problem.

Worker Node A has absolutely no interface with that IP.

Worker Node B has never heard of Pod `10.244.1.5`.

Neither node knows where the other's Pods live.

Yet the packet still arrives.

How?

Welcome to the networking fabric of Kubernetes.

---

# Kubernetes Makes Every Pod Look Like It's on One Big Network

One of Kubernetes' most important promises is this:

> **Every Pod can communicate with every other Pod without Network Address Translation (NAT).**

That sounds simple.

It's actually a huge engineering challenge.

Imagine three worker nodes.

```text id="pkt1ad"
Worker 1

Pods

10.244.1.x

────────────────────────

Worker 2

Pods

10.244.2.x

────────────────────────

Worker 3

Pods

10.244.3.x
```

Every Pod receives its own IP address.

Not a private IP hidden behind the node.

Not a port number.

An actual IP address.

And every other Pod can reach it directly.

From the application's perspective,

the cluster behaves as though every Pod is connected to one enormous Ethernet switch.

Even though they're spread across multiple physical machines.

This illusion is one of Kubernetes' greatest strengths.

And it's entirely the responsibility of the **Container Network Interface**, or **CNI**.

---

# Meet the CNI

Earlier in this series, we treated the CNI like a black box.

Now it's time to open it.

The CNI isn't a single piece of software.

It's a **standard**.

Think of it like USB.

USB defines how devices communicate.

Different manufacturers build different devices.

The same is true here.

The CNI specification defines how Kubernetes expects networking plugins to behave.

Different projects implement that specification.

Some of the most popular implementations include:

* Flannel
* Calico
* Cilium
* Weave Net
* Canal
* Kube-router

And, if you've been following my previous articles, perhaps even **your own CNI**.

Every one of these plugins has exactly the same goal:

> **Make every Pod reachable from every other Pod, regardless of which node it's running on.**

How they achieve that goal is where things become interesting.

---

# What Happens When a Pod Is Created?

Suppose Kubernetes schedules a new Pod.

```bash id="pkt1ae"
kubectl run nginx \
--image=nginx
```

The scheduler decides:

> "Run this Pod on Worker Node 2."

At that point,

the kubelet asks the container runtime to create the Pod.

The container runtime then asks the configured CNI plugin to set up networking.

The sequence looks like this.

```text id="pkt1af"
Scheduler

      │

Chooses Node

      │

      ▼

kubelet

      │

      ▼

Container Runtime

      │

      ▼

CNI Plugin

      │

Creates Network
```

This is where the CNI begins its work.

Depending on the implementation,

it may:

* create a network namespace
* create a veth pair
* connect one end to a Linux bridge
* assign a Pod IP
* configure routes
* configure firewall rules
* join an overlay network

By the time the container starts,

networking is already functional.

---

# The Building Blocks

Before we can understand how packets cross nodes,

we need to understand the building blocks used by almost every CNI implementation.

These are standard Linux networking features.

Not Kubernetes features.

Let's start with the simplest one.

---

# Network Namespaces

Every Pod lives inside its own network namespace.

Think of a network namespace as an isolated networking environment.

Each namespace has its own:

* network interfaces
* routing table
* ARP table
* firewall rules
* localhost

To the application,

it appears to own an entire machine.

Let's prove it.

Enter a Pod.

```bash id="pkt1ag"
kubectl exec \
-it deploy/frontend \
-- ip addr
```

You'll see something similar to:

```text id="pkt1ah"
1: lo

2: eth0
```

Only two interfaces.

`lo` (loopback)

and

`eth0`.

Where's the host's network interface?

Where's `ens160`?

Where's `eth1`?

They're gone.

Because the Pod lives inside its own isolated network namespace.

---

# The veth Pair

Now here's the clever part.

The Pod isn't actually disconnected from the host.

Instead,

Linux creates something called a **virtual Ethernet pair**, usually called a **veth pair**.

Think of it like a network cable with two ends.

```text id="pkt1ai"
Pod Namespace

eth0

──────────────

veth Pair

──────────────

Host Namespace

vethXXXXX
```

Whatever enters one end immediately exits the other.

It's almost like plugging two Ethernet ports together with a cable.

One end lives inside the Pod.

The other end lives on the worker node.

This is the bridge between the Pod and the host's networking stack.

---

# The Linux Bridge

Now imagine three Pods on the same node.

```text id="pkt1aj"
Pod A

eth0

      │

Pod B

eth0

      │

Pod C

eth0
```

How do they communicate?

Connecting every Pod directly to every other Pod would quickly become impossible.

Instead,

Linux provides another networking primitive:

a **bridge**.

You can think of a Linux bridge as a software Ethernet switch.

```text id="pkt1ak"
                Linux Bridge

        ┌──────────┼──────────┐

        │          │          │

      veth1      veth2      veth3

        │          │          │

      Pod A      Pod B      Pod C
```

Packets entering the bridge are forwarded to the correct destination,

just like a physical network switch.

Most CNIs either use Linux bridges directly,

or implement something functionally equivalent.

---

# Following the Packet

Let's revisit our frontend Pod.

```text id="pkt1al"
Frontend Pod

10.244.1.5
```

The backend lives on another node.

```text id="pkt1am"
Backend Pod

10.244.2.14
```

The frontend sends a packet.

```text id="pkt1an"
Destination

10.244.2.14
```

The packet leaves:

```text id="pkt1ao"
Application

        │

eth0

        │

veth Pair

        │

Linux Bridge

        │

Host Network Namespace

        │

???
```

We've now left the Pod.

We've crossed the veth pair.

We've reached the worker node.

But another mystery appears.

The Linux bridge knows how to forward packets **within this node**.

It has absolutely no idea where:

```text id="pkt1ap"
10.244.2.14
```

lives.

It's not attached to this bridge.

It's not attached to this machine.

So how does the packet leave one worker node and find the correct worker somewhere else in the cluster?

That is where Kubernetes networking becomes truly fascinating.

Some CNIs build an **overlay network** using technologies like **VXLAN** or **Geneve**, encapsulating packets so they can travel across any existing network.

Others avoid encapsulation entirely, using **native routing** and protocols like **BGP** to teach the physical network where every Pod subnet lives.

Both approaches solve the same problem—but in very different ways.

In the next part, we'll explore the first approach: **overlay networking**. We'll see how VXLAN wraps an entire packet inside another packet, allowing Pods on different nodes to communicate as though they were connected to the same Layer 2 network, even when the underlying infrastructure knows nothing about Kubernetes.

# How Packets Cross Nodes in Kubernetes (Part 2)

## Overlay Networks, VXLAN, and How Kubernetes Tricks the Physical Network

At the end of Part 1, our packet had reached the worker node.

Let's replay the journey.

```text
Frontend Pod

10.244.1.5

        │

eth0

        │

veth Pair

        │

Linux Bridge

        │

Host Network Namespace

        │

        ▼

???
```

The packet is no longer inside the Pod.

It's now in the Linux networking stack of Worker Node A.

Its destination is still:

```text
10.244.2.14
```

But there's a problem.

The physical network doesn't know anything about Pod IPs.

Your switches don't.

Your routers don't.

AWS doesn't.

Azure doesn't.

Your home router certainly doesn't.

The only devices that understand Pod IP addresses are the Kubernetes nodes themselves.

So how does the packet cross the network?

There are two major approaches.

1. **Overlay networking**
2. **Native routing**

In this part, we'll focus on overlay networking.

---

# Imagine You're Shipping a Letter

Suppose you want to send a letter to someone inside a company.

You write:

```text
Engineering Department
Desk 42
```

But the postal service has no idea where "Desk 42" is.

Instead, you place that letter inside another envelope.

The outer envelope says:

```text
Company Headquarters

123 Main Street
```

The postal service delivers it to headquarters.

Someone inside opens the outer envelope.

Now they can deliver the inner letter to Desk 42.

That's almost exactly how VXLAN works.

---

# The Original Packet

Our frontend Pod creates this packet.

```text
Source

10.244.1.5

Destination

10.244.2.14
```

Unfortunately,

the physical network has no route to:

```text
10.244.2.14
```

If we tried to send it directly,

our router would simply respond:

> "I have no idea where that network is."

So the CNI does something clever.

It wraps the packet inside another packet.

---

# Encapsulation

Instead of changing the original packet,

the CNI creates a completely new one.

```text
Outer Packet

Source

192.168.56.11

Destination

192.168.56.12

────────────────────────────

Inner Packet

Source

10.244.1.5

Destination

10.244.2.14
```

Notice the difference.

The **inner packet** is untouched.

It's still a Pod talking to another Pod.

The **outer packet** contains something the physical network understands:

the IP addresses of the worker nodes.

The network no longer needs to know anything about Pods.

It only needs to know how to reach another server.

Problem solved.

---

# What Is VXLAN?

VXLAN stands for:

> **Virtual eXtensible Local Area Network**

Despite the intimidating name,

the idea is simple.

VXLAN creates a virtual Layer 2 network on top of an existing Layer 3 network.

Think of it as creating an imaginary Ethernet switch that spans your entire cluster.

```text
                 Virtual Switch

     Pod A

        │

     Worker 1

═══════════════════════════════════

          Physical Network

═══════════════════════════════════

     Worker 2

        │

     Pod B
```

To the Pods,

it feels like they're plugged into the same switch.

The physical network has no idea this virtual switch exists.

---

# The VXLAN Tunnel

Every worker node participating in VXLAN creates a virtual network interface.

You can inspect it.

```bash
ip link
```

Depending on your CNI,

you might see something like:

```text
flannel.1

vxlan.calico

cilium_vxlan
```

That interface represents the entrance to the VXLAN tunnel.

Conceptually,

the tunnel looks like this.

```text
Worker Node A

Frontend Pod

        │

VXLAN Tunnel

═══════════════════════

Worker Node B

Backend Pod
```

The packet enters the tunnel on one node,

travels across the physical network,

and exits the tunnel on the destination node.

---

# Following the Packet

Let's watch the journey step by step.

```text
Frontend Pod

10.244.1.5

        │

Creates Packet

        ▼

Destination

10.244.2.14

        │

        ▼

CNI

        │

Encapsulates Packet

        ▼

Outer Destination

192.168.56.12

        │

        ▼

Physical Network
```

Notice something.

The physical switches never see:

```text
10.244.2.14
```

They only ever see:

```text
192.168.56.12
```

From their perspective,

they're simply forwarding traffic between two servers.

---

# Decapsulation

Eventually,

the packet reaches Worker Node B.

The VXLAN interface recognizes:

> "This packet is for me."

It removes the outer header.

What's left?

Exactly the original packet.

```text
Source

10.244.1.5

Destination

10.244.2.14
```

Now the destination Pod actually exists on this machine.

The Linux bridge forwards the packet to the correct veth interface,

and finally,

the backend Pod receives it.

---

# Visualizing the Entire Journey

```text
Frontend Pod

10.244.1.5

        │

Original Packet

        ▼

10.244.2.14

        │

        ▼

VXLAN Encapsulation

        │

        ▼

Outer Packet

192.168.56.11

↓

192.168.56.12

        │

═══════════════════════

Physical Network

═══════════════════════

        │

        ▼

Worker Node B

        │

VXLAN Decapsulation

        │

        ▼

Original Packet

10.244.1.5

↓

10.244.2.14

        │

        ▼

Backend Pod
```

The application never knows any of this happened.

As far as it's concerned,

it simply sent a packet to another Pod.

---

# Why Use an Overlay Network?

Overlay networks solve a difficult problem elegantly.

Imagine deploying Kubernetes inside an existing corporate network.

The network team may not want to advertise hundreds of Pod subnets.

They may not even allow routing changes.

VXLAN avoids all of that.

The only requirement is:

> Every worker node must be able to reach every other worker node.

That's already true in almost every Kubernetes cluster.

Everything else happens inside the overlay.

---

# The Trade-Off

Nothing comes for free.

Every encapsulated packet is slightly larger.

Remember,

we added another IP header.

Sometimes another UDP header too.

That means the packet consumes more bytes on the wire.

This introduces two important considerations.

## Additional Overhead

Every packet now carries extra networking information.

That slightly reduces the amount of application data that fits into a single Ethernet frame.

---

## MTU

Suppose your physical network supports an MTU of:

```text
1500 bytes
```

After adding VXLAN headers,

the original packet must become smaller to avoid fragmentation.

Many CNIs automatically reduce the Pod MTU to account for this overhead.

If they don't,

you may encounter mysterious networking problems where:

* small requests work,
* large requests fail,
* or packets become fragmented.

MTU issues are among the most common networking problems in overlay-based Kubernetes clusters.

---

# Which CNIs Use VXLAN?

Several popular CNIs use VXLAN by default or as one of their operating modes.

Examples include:

* Flannel (VXLAN backend)
* Calico (optional VXLAN mode)
* Cilium (optional VXLAN mode)
* Weave Net (overlay networking)

Although their implementations differ,

the underlying principle remains the same:

1. Encapsulate the Pod packet.
2. Send it between worker nodes.
3. Remove the outer header.
4. Deliver the original packet.

---

# But Is Encapsulation Always Necessary?

Overlay networking is incredibly flexible.

It works almost anywhere.

But it isn't the only solution.

Some Kubernetes environments avoid encapsulation entirely.

Instead of hiding Pod networks from the physical infrastructure,

they teach the infrastructure exactly where every Pod subnet lives.

No extra headers.

No tunnels.

No encapsulation.

How?

Through **routing**.

And in large production environments,

that often means one protocol:

**BGP (Border Gateway Protocol).**

In the next part, we'll explore native routing, understand how BGP allows switches and routers to learn Pod networks dynamically, compare it directly with VXLAN, and see why different CNIs make different design choices depending on where they're deployed.

# How Packets Cross Nodes in Kubernetes (Part 3)

## Native Routing, BGP, and Why Some CNIs Don't Need Tunnels

In Part 2, we learned how overlay networks like VXLAN solve the cross-node networking problem.

The idea was elegant.

Wrap the Pod packet inside another packet.

Send it across the physical network.

Remove the outer packet at the destination.

Deliver the original packet to the backend Pod.

```text id="bgp1aa"
Original Packet

10.244.1.5

↓

10.244.2.14

        │

VXLAN

        ▼

Outer Packet

192.168.56.11

↓

192.168.56.12

        │

Physical Network

        ▼

Original Packet

10.244.1.5

↓

10.244.2.14
```

It works almost everywhere.

But it isn't the only way.

Some CNIs take a completely different approach.

Instead of hiding Pod networks from the physical network...

they teach the physical network about them.

---

# Imagine a City

Suppose you're driving to a new neighborhood.

There are two possible approaches.

## Option 1

Someone picks up your car.

Places it inside a truck.

Drives the truck to the destination city.

Removes your car.

You continue driving.

That's VXLAN.

Your car never needed to know the roads.

---

## Option 2

The city simply builds proper roads and signs.

You drive directly there yourself.

No truck.

No wrapping.

No extra steps.

That's **native routing**.

Instead of hiding Pod networks,

the infrastructure knows exactly where they are.

---

# The Problem

Imagine this cluster.

```text id="bgp1ab"
Worker 1

Pod Network

10.244.1.0/24

────────────────────────

Worker 2

Pod Network

10.244.2.0/24

────────────────────────

Worker 3

Pod Network

10.244.3.0/24
```

Worker 1 wants to send traffic to:

```text id="bgp1ac"
10.244.2.14
```

The Linux routing table asks:

> "How do I reach the network `10.244.2.0/24`?"

If there's no answer,

the packet dies.

So we need routing information.

---

# Static Routes

The simplest solution would be to manually configure routes.

Worker 1.

```text id="bgp1ad"
Destination

10.244.2.0/24

↓

Next Hop

192.168.56.12
```

Worker 2.

```text id="bgp1ae"
Destination

10.244.1.0/24

↓

Next Hop

192.168.56.11
```

This works.

Until your cluster grows.

Imagine:

* 300 worker nodes
* nodes joining every hour
* autoscaling
* failed machines
* replacements

Manually maintaining routes would become impossible.

We need automation.

---

# Enter BGP

BGP stands for:

> **Border Gateway Protocol**

It's one of the most important routing protocols on the Internet.

In fact,

the Internet itself largely works because routers continuously exchange routes using BGP.

Large cloud providers use it.

Internet Service Providers use it.

Data centers use it.

And Kubernetes CNIs can use it too.

---

# What Does BGP Actually Do?

Think of every worker node as introducing itself.

Worker 2 says:

> "Hello everyone.

> I own the network:

```text id="bgp1af"
10.244.2.0/24
```

If you ever need to reach it,

send traffic to me."

Worker 3 says:

> "I own:

```text id="bgp1ag"
10.244.3.0/24
```

Worker 1 says:

> "I own:

```text id="bgp1ah"
10.244.1.0/24
```

Soon,

every router learns where every Pod subnet lives.

---

# Visualizing Route Advertisement

Imagine three workers.

```text id="bgp1ai"
        Worker 1

Announces

10.244.1.0/24

        ▲

        │

        ▼

Router

        ▲

        │

        ▼

Worker 2

Announces

10.244.2.0/24

        ▲

        │

        ▼

Worker 3

Announces

10.244.3.0/24
```

The router now understands the cluster.

It doesn't know about individual Pods.

It doesn't need to.

It only needs to know which worker owns each subnet.

---

# Following the Packet

Let's replay our request.

Frontend Pod.

```text id="bgp1aj"
10.244.1.5
```

Backend Pod.

```text id="bgp1ak"
10.244.2.14
```

The frontend sends:

```text id="bgp1al"
Destination

10.244.2.14
```

Worker 1 checks its routing table.

```text id="bgp1am"
10.244.2.0/24

↓

Next Hop

192.168.56.12
```

No encapsulation.

No VXLAN.

The packet simply leaves Worker 1 like any other IP packet.

The router forwards it.

Worker 2 receives it.

Its Linux bridge delivers the packet to the backend Pod.

Done.

---

# Overlay vs Native Routing

Let's compare both approaches.

## VXLAN

```text id="bgp1an"
Pod Packet

↓

Encapsulate

↓

Physical Network

↓

Decapsulate

↓

Destination Pod
```

---

## Native Routing

```text id="bgp1ao"
Pod Packet

↓

Routing Table

↓

Physical Network

↓

Destination Pod
```

The second path is shorter.

There are fewer operations.

No extra headers.

No tunnel endpoints.

---

# Why Doesn't Everyone Use Native Routing?

Because it requires cooperation from the network.

Suppose your Kubernetes cluster runs inside a corporate data center.

If the routers support BGP,

or your network team allows Pod routes,

native routing can work beautifully.

Now imagine deploying Kubernetes on a random collection of virtual machines,

or inside an environment where you can't control the network.

You can't ask someone else's routers to learn your Pod networks.

VXLAN becomes much easier.

This is why the choice often depends on **where** Kubernetes is running.

---

# Which CNIs Use BGP?

One of the best-known examples is **Calico**.

Calico supports several networking modes.

One of them is pure BGP routing.

Instead of building tunnels,

Calico advertises Pod subnets directly.

Another example is **Kube-router**,

which also relies heavily on BGP.

Some cloud providers implement similar ideas behind the scenes,

although the details vary between platforms.

---

# What About Cilium?

Cilium is an interesting case.

Cilium can use:

* VXLAN
* Geneve
* native routing

depending on how it's configured.

But Cilium is also famous for something else.

Instead of relying heavily on iptables,

it can move much of the packet processing into **eBPF**.

We'll briefly touch on eBPF later in this article,

but it deserves an entire series of its own.

---

# Which Is Faster?

People often ask:

> "Which one is faster?"

The honest answer is:

**It depends.**

Native routing generally avoids the overhead of encapsulation.

Packets are smaller.

There are fewer processing steps.

But those advantages only matter if your infrastructure supports native routing.

VXLAN,

on the other hand,

works almost anywhere.

It's simple to deploy because it doesn't require modifying the surrounding network.

In practice,

many production environments choose whichever approach best fits their infrastructure rather than chasing tiny performance differences.

---

# A Comparison

| Feature                           | VXLAN                   | Native Routing              |
| --------------------------------- | ----------------------- | --------------------------- |
| Packet Encapsulation              | Yes                     | No                          |
| Additional Packet Overhead        | Yes                     | No                          |
| Requires Physical Network Changes | No                      | Often yes                   |
| Easy to Deploy Anywhere           | Yes                     | Depends                     |
| Uses Existing Routers             | No                      | Yes                         |
| Common CNIs                       | Flannel, Calico, Cilium | Calico, Kube-router, Cilium |

Neither approach is universally "better."

They're simply different engineering solutions to the same problem.

---

# But There's Another Piece We Haven't Discussed Yet

Whether you're using VXLAN or BGP,

one important question remains.

How does the worker node actually decide **which interface** should send the packet?

What happens when a Pod wants to reach the public Internet instead of another Pod?

Where does Source NAT (SNAT) come into the picture?

And what role do Linux routing tables, ARP, and connection tracking play in all of this?

In the final part of this article, we'll complete the journey by exploring Linux routing tables, packet forwarding, internet-bound traffic, SNAT, and the practical debugging tools you should use whenever cross-node networking doesn't behave the way you expect.


# How Packets Cross Nodes in Kubernetes (Part 4)

## Routing Tables, Internet Access, NAT, and Debugging Cross-Node Networking

Over the last three parts, we've followed a packet from one Pod to another across different worker nodes.

We've learned that:

* Every Pod has its own IP address.
* Pods are connected to their worker node through a **veth pair**.
* Pods on the same node communicate through a **Linux bridge** (or an equivalent mechanism provided by the CNI).
* Pods on different nodes communicate using either an **overlay network** (such as VXLAN) or **native routing** (often using BGP).

At this point, we finally have a complete path between Pods.

But there's another journey every Kubernetes cluster must support.

What happens when a Pod wants to reach **the Internet**?

---

# A Different Journey

Instead of contacting another Pod,

our frontend application now runs:

```bash id="net4a"
curl https://api.github.com
```

Immediately,

the packet's destination changes.

Instead of:

```text id="net4b"
10.244.2.14
```

it's now something like:

```text id="net4c"
140.82.121.5
```

That's an Internet address.

No worker node owns it.

No EndpointSlice exists.

CoreDNS already resolved the name.

kube-proxy isn't involved because we're not communicating with a Kubernetes Service.

So what happens now?

---

# Linux Routing Tables

Every Linux machine has a routing table.

You can inspect it.

```bash id="net4d"
ip route
```

Example:

```text id="net4e"
default via 192.168.56.1 dev eth0

10.244.1.0/24 dev cni0

192.168.56.0/24 dev eth0
```

This table tells Linux where packets should go.

Think of it as Google Maps for the kernel.

Suppose a packet is destined for:

```text id="net4f"
10.244.1.18
```

Linux sees:

```text id="net4g"
10.244.1.0/24

↓

Use cni0
```

Easy.

Now suppose the destination is:

```text id="net4h"
8.8.8.8
```

No specific route exists.

Linux uses the:

```text id="net4i"
default
```

route.

In our example,

that means sending the packet to:

```text id="net4j"
192.168.56.1
```

usually the node's default gateway.

---

# The Problem

Let's inspect our packet.

```text id="net4k"
Source

10.244.1.5

Destination

8.8.8.8
```

Looks fine.

Until it reaches the Internet.

Imagine you're Google's router.

A packet arrives from:

```text id="net4l"
10.244.1.5
```

Should Google know how to reply?

No.

That Pod IP only exists inside your Kubernetes cluster.

If Google sends the response back,

Internet routers have no route to:

```text id="net4m"
10.244.1.5
```

The packet would disappear.

So Kubernetes has one more trick.

---

# Source NAT (SNAT)

Before the packet leaves the worker node,

its **source address** is rewritten.

Originally:

```text id="net4n"
Source

10.244.1.5
```

After SNAT:

```text id="net4o"
Source

192.168.56.11
```

The destination remains:

```text id="net4p"
8.8.8.8
```

Now Google sees a perfectly normal packet.

```text id="net4q"
192.168.56.11

↓

8.8.8.8
```

Google replies to:

```text id="net4r"
192.168.56.11
```

The worker node receives the response.

Linux remembers the original translation.

It reverses the process.

```text id="net4s"
192.168.56.11

↓

10.244.1.5
```

Finally,

the packet reaches the Pod.

To the application,

it appears as though it communicated directly with Google.

---

# Connection Tracking

This magic depends on another Linux subsystem:

**conntrack**.

Earlier,

we saw conntrack ensuring that packets belonging to the same TCP connection always reach the same backend Pod.

It also remembers NAT translations.

Imagine the first packet.

```text id="net4t"
10.244.1.5

↓

192.168.56.11
```

conntrack records the mapping.

Later,

when Google's reply arrives,

Linux checks conntrack.

```text id="net4u"
192.168.56.11

↓

10.244.1.5
```

The response is translated back automatically.

Without conntrack,

NAT simply wouldn't work.

---

# Packet Forwarding

There's another important setting.

Linux machines normally don't forward packets between interfaces.

They behave like endpoints.

A Kubernetes worker node behaves more like a router.

You can verify this.

```bash id="net4v"
sysctl net.ipv4.ip_forward
```

Typical output:

```text id="net4w"
net.ipv4.ip_forward = 1
```

That single value tells Linux:

> "You're allowed to forward packets between network interfaces."

Without it,

cross-node Pod communication would stop working.

---

# ARP: Finding the Next Device

Suppose Worker Node A wants to send a packet to Worker Node B.

It knows the destination IP:

```text id="net4x"
192.168.56.12
```

But Ethernet doesn't send frames using IP addresses.

It sends them using **MAC addresses**.

Linux therefore asks:

> "Who owns `192.168.56.12`?"

using the **Address Resolution Protocol (ARP)**.

The destination node replies:

> "That's me."

along with its MAC address.

Linux stores that mapping temporarily.

You can inspect it.

```bash id="net4y"
ip neigh
```

You'll see entries like:

```text id="net4z"
192.168.56.12

↓

08:00:27:ab:cd:ef
```

Now the Ethernet frame can finally be transmitted.

---

# Following the Entire Journey

Let's put everything together.

```text id="net4aa"
Frontend Pod

10.244.1.5

        │

eth0

        │

veth Pair

        │

Linux Bridge

        │

Routing Table

        │

VXLAN

or

Native Routing

        │

Worker Node B

        │

Linux Bridge

        │

veth Pair

        │

Backend Pod
```

And for Internet traffic:

```text id="net4ab"
Frontend Pod

        │

DNS Lookup

        │

CoreDNS

        │

Internet IP

        │

Routing Table

        │

SNAT

        │

Default Gateway

        │

Internet

        │

Response

        │

conntrack

        │

Reverse NAT

        │

Frontend Pod
```

Everything we've learned over the last four articles is now connected.

---

# Debugging Cross-Node Networking

When Pod-to-Pod communication fails,

walk the packet's journey.

### Check the Pod IP

```bash id="net4ac"
kubectl get pods -o wide
```

---

### Inspect the routes

```bash id="net4ad"
ip route
```

---

### Inspect neighboring hosts

```bash id="net4ae"
ip neigh
```

---

### Capture packets

One of the most powerful debugging tools is:

```bash id="net4af"
tcpdump
```

For example:

```bash id="net4ag"
sudo tcpdump -i any port 53
```

captures DNS traffic.

Or:

```bash id="net4ah"
sudo tcpdump -i any host 10.244.2.14
```

captures traffic to a specific Pod.

Watching packets move through the node is often the fastest way to understand where they're being dropped.

---

### Inspect conntrack

```bash id="net4ai"
sudo conntrack -L
```

This lets you inspect active NAT translations and tracked TCP connections.

---

### Inspect CNI Interfaces

```bash id="net4aj"
ip link
```

Depending on your CNI,

you might see:

* `cni0`
* `flannel.1`
* `vxlan.calico`
* `cilium_vxlan`

These interfaces often reveal exactly how your CNI is connecting Pods together.

---

# What We've Learned

At the beginning of this series,

a simple command seemed almost magical.

```bash id="net4ak"
curl http://backend.backend
```

Now we know every step involved.

The journey actually looks like this.

```text id="net4al"
Application

        │

CoreDNS

        │

ClusterIP

        │

kube-proxy

        │

Pod IP

        │

veth Pair

        │

Linux Bridge

        │

Routing Table

        │

Overlay Network

or

Native Routing

        │

Destination Node

        │

Linux Bridge

        │

Destination Pod
```

Every component has a specific responsibility.

* **CoreDNS** translates names into IP addresses.
* **kube-proxy** converts virtual Service IPs into real Pod IPs.
* The **CNI** connects Pods across nodes.
* The **Linux routing table** decides where packets should go.
* **ARP** discovers the next device on the local network.
* **conntrack** keeps TCP sessions and NAT translations consistent.
* **SNAT** allows Pods to communicate with the public Internet.

None of these components work in isolation.

Together, they create the illusion that every Pod is simply connected to one giant, flat network—even when those Pods are spread across dozens or hundreds of worker nodes.

---

# What's Next?

Over the last four articles, we've followed packets from almost every angle:

* Service discovery with **CoreDNS**
* Virtual Services with **kube-proxy**
* Cross-node networking with **CNIs**
* Overlay networks, native routing, and Internet access

At this point, you have a mental model of how packets move through Kubernetes.

The next logical question is no longer about networking.

It's about the control plane.

How did Kubernetes know where to schedule the Pod in the first place?

Who created the Service?

Who created the EndpointSlice?

Who keeps everything synchronized?

In the next series, we'll leave the data plane behind and step into the Kubernetes control plane, dissecting the **API Server**, **etcd**, **kube-scheduler**, and **kube-controller-manager** to understand how Kubernetes continuously drives the cluster toward its desired state.
