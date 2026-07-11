---
title: "Building a Kubernetes CNI From Scratch (Part 4): Connecting Pods Across Multiple Nodes"
description: "Our CNI can now connect pods on the same node. In this article, we'll extend it to support communication between pods running on different worker nodes by teaching Linux how to route traffic between Pod CIDRs."
date: "2026-07-06"
tags: "Kubernetes, CNI, Linux Networking, Routing, Platform Engineering, Cloud Native"
cover: "/blog/cni-01/image-01.png"
published: false
order: 7
series: "Building a Kubernetes CNI From Scratch"
seriesOrder: 4
---

In [Part 3](/blog/cni-03), we finally built a working CNI.

Not Calico.

Not Cilium.

Not Flannel.

Our own.

Using nothing more than Bash and standard Linux networking commands, we created a Linux bridge, allocated Pod IP addresses, created virtual Ethernet pairs, connected Pods to the bridge, configured routes inside each Pod, and returned a valid CNI result back to containerd.

By the end of that article, we had successfully enabled:

- Host → Pod communication
- Pod → Host communication
- Pod → Pod communication on the same node

That already feels like a complete networking solution.

Unfortunately, it isn't.

Kubernetes clusters rarely consist of a single worker node.

The real challenge begins once Pods are scheduled onto different nodes.

Suppose we have the following cluster.

```
                    Kubernetes Cluster
            +------------------------------+
              Worker-1          Worker-2
          Pod CIDR            Pod CIDR
        10.244.1.0/24      10.244.2.0/24
        nginx              redis
      10.244.1.2         10.244.2.2
        api               postgres
      10.244.1.3         10.244.2.3
```

Everything still works locally.

Pods on Worker-1 can communicate with one another.

Pods on Worker-2 can communicate with one another.

But now suppose our API Pod running on Worker-1 wants to talk to Redis running on Worker-2.

```
10.244.1.3
        │
        │
        ▼
10.244.2.2
```

The communication immediately fails.

Not because Kubernetes blocks it.

Not because Redis is unavailable.

Not because our CNI is broken.

Linux simply has no idea where the network `10.244.2.0/24` exists.

And Linux cannot send packets to networks it doesn't know how to reach.

In this article, we'll solve that problem.

Instead of teaching Pods about one another, we'll teach the **nodes**.

Once every node knows where every Pod network lives, Kubernetes networking suddenly becomes much simpler than it first appears.


## Understanding Why Cross-Node Communication Fails

Let's go back to Worker-1.

Earlier, our CNI created a bridge called:

```bash
cni0
```

It assigned the bridge:

```
10.244.1.1/24
```

Every Pod on Worker-1 received an address from:

```
10.244.1.0/24
```

If we inspect the routing table on Worker-1:

```bash
ip route
```

we'll see something similar to:

```
10.244.1.0/24 dev cni0
192.168.56.0/24 dev eth1
default via 192.168.56.1
```

Let's understand what Linux is saying.

```
10.244.1.0/24
```

means:

> "Pods on my own node can be reached through the Linux bridge."

```
192.168.56.0/24
```

means:

> "Other machines on my private network can be reached through eth1."

Finally,

```
default via 192.168.56.1
```

means:

> "If I don't know where a packet belongs, send it to my default gateway."

Notice what is missing.

There is absolutely no mention of:

```
10.244.2.0/24
```

That subnet simply does not exist inside Worker-1's routing table.

Now imagine our Pod sends a packet to:

```
10.244.2.2
```

The packet leaves the Pod.

```
Pod
 │
 ▼
eth0
 │
 ▼
veth
 │
 ▼
cni0
 │
 ▼
Worker-1 Routing Table
```

Linux now checks:

```
Where is 10.244.2.2?
```

It searches every route.

```
10.244.1.0/24
No.
```

```
192.168.56.0/24
No.
```

```
Default Gateway
```

Linux eventually gives the packet to the default gateway, which also has no idea that Kubernetes Pods live behind Worker-2.

Eventually, the packet is dropped.

Our networking has reached its limit.

The bridge solved networking **inside one machine**.

Now we need routing **between machines**.


## The Solution Is Surprisingly Simple

Many people assume Kubernetes networking requires complex overlays, VXLAN tunnels or SDNs.

Those technologies certainly exist.

But before any of them, Linux already has an incredibly powerful routing engine.

The only thing Worker-1 is missing is knowledge.

Specifically:

> Worker-1 doesn't know that Worker-2 owns the network `10.244.2.0/24`.

Likewise:

> Worker-2 doesn't know that Worker-1 owns `10.244.1.0/24`.

If we teach every worker where every Pod CIDR lives, Linux will happily route packets between them.

For example, suppose:

```
Worker-1
Node IP
192.168.56.101
Pod CIDR
10.244.1.0/24
```

```
Worker-2
Node IP
192.168.56.102
Pod CIDR
10.244.2.0/24
```

Worker-1 only needs one additional route.

```
10.244.2.0/24 via 192.168.56.102
```

Worker-2 also needs one.

```
10.244.1.0/24 via 192.168.56.101
```

That's it.

Once Linux knows which node owns each Pod subnet, packets naturally begin flowing between workers.

Surprisingly, Kubernetes itself doesn't perform this routing.

The CNI is responsible for making sure the underlying Linux networking knows how to reach every Pod network.

In the next section, we'll start teaching Linux exactly how to do that by adding routes to every node's routing table.

## Teaching Linux About Other Pod Networks

Earlier, we discovered that Worker-1 only knows how to reach Pods running on its own bridge.

Likewise, Worker-2 only knows about its own Pods.

To Linux, these are simply two different IP subnets.

```
Worker-1
10.244.1.0/24
```

```
Worker-2
10.244.2.0/24
```

Linux doesn't know that these are Kubernetes Pods.

It doesn't even know Kubernetes exists.

All Linux sees are IP packets.

If it knows where the destination network lives, it forwards the packet.

If it doesn't, the packet is dropped or forwarded to the default gateway.

Our job as a CNI is therefore very simple:

> Teach Linux where every Pod subnet lives.

Fortunately, Linux already has a mechanism for this.

It's called the **routing table**.


## Adding Routes Between Nodes

Suppose our nodes have the following addresses.

| Node | Node IP | Pod CIDR |
|------|----------|-----------|
| Worker-1 | 192.168.56.101 | 10.244.1.0/24 |
| Worker-2 | 192.168.56.102 | 10.244.2.0/24 |

On Worker-1, we simply tell Linux:

```bash
ip route add 10.244.2.0/24 via 192.168.56.102
```

Let's break that command down.

```
10.244.2.0/24
```

This is the destination network.

We're telling Linux:

> "Whenever you see packets destined for this subnet..."

Then:

```
via 192.168.56.102
```

means:

> "...forward those packets to Worker-2."

Worker-2 now becomes the **next hop**.

Likewise, on Worker-2 we add:

```bash
ip route add 10.244.1.0/24 via 192.168.56.101
```

Now Worker-2 knows how to reach Pods running on Worker-1.

Finally, the control-plane node (or any machine that wants to directly reach Pods) also needs routes.

For example:

```bash
ip route add 10.244.1.0/24 via 192.168.56.101
ip route add 10.244.2.0/24 via 192.168.56.102
```

Now the control-plane node can also communicate directly with Pods.

Notice something interesting.

We haven't modified Kubernetes.

We haven't modified containerd.

We haven't modified the Pods.

We've simply taught Linux where those networks exist.


## Following a Packet Across Two Nodes

Now let's trace a packet from one Pod to another.

Suppose:

```
Pod A
10.244.1.2
Worker-1
```

wants to communicate with

```
Pod B
10.244.2.2
Worker-2
```

The packet follows this path.

```
                Pod A
            10.244.1.2
                  │
                eth0
                  │
             veth pair
                  │
               cni0
                  │
       Worker-1 Routing Table
                  │
     Route says:
     10.244.2.0/24
           via
     192.168.56.102
                  │
          Worker-1 eth1
                  │
================ Physical Network ================
                  │
          Worker-2 eth1
                  │
       Worker-2 Routing Table
                  │
     Route says:
     10.244.2.0/24
          directly connected
                  │
               cni0
                  │
             veth pair
                  │
               Pod B
            10.244.2.2
```

Nothing magical happened.

No overlay network.

No VXLAN.

No encapsulation.

Linux simply looked at its routing table and forwarded the packet like it has done for decades.

This is one of the reasons I wanted to build this CNI from scratch.

Many engineers think Kubernetes networking is some mysterious system hidden inside Kubernetes.

In reality, Kubernetes is simply orchestrating standard Linux networking features.


## Testing Cross-Node Communication

Now it's time to verify that our routing works.

First, create two Pods.

One should run on Worker-1.

The other should run on Worker-2.

For testing purposes, you can pin them to specific nodes using `nodeName`.

Once both Pods are running, verify their IP addresses.

```bash
kubectl get pods -o wide
```

Example output:

```
NAME      READY   STATUS    IP            NODE
nginx     1/1     Running   10.244.1.2    worker-1
redis     1/1     Running   10.244.2.2    worker-2
```

Now enter the nginx Pod.

```bash
kubectl exec -it nginx -- sh
```

Try reaching the Redis Pod.

```bash
ping 10.244.2.2
```

or

```bash
nc -vz 10.244.2.2 6379
```

If your routes are correct, communication succeeds.

At this point, our CNI now supports:

- Host → Pod
- Pod → Host
- Pod → Pod on the same node
- **Pod → Pod across different nodes**

From Kubernetes' perspective, networking is now behaving exactly as expected.

Applications no longer care where their peers are running.

Whether two Pods share a node or live on opposite sides of the cluster, communication works exactly the same.

That is one of the biggest promises Kubernetes networking makes.


## The Problem With Static Routes

Although our solution works, it has a serious limitation.

Imagine adding a third worker.

```
Worker-3
192.168.56.103
10.244.3.0/24
```

Now every existing node must learn about this new subnet.

Worker-1 needs:

```bash
ip route add 10.244.3.0/24 via 192.168.56.103
```

Worker-2 needs the same route.

The control-plane node also needs the same route.

As more nodes join the cluster, the number of manual route updates grows quickly.

The opposite problem also exists.

Suppose Worker-2 is removed from the cluster.

Every other machine still contains a route pointing to:

```
192.168.56.102
```

Those routes are now stale.

Packets continue being sent to a node that no longer exists.

Even worse, imagine rebooting a worker.

Routes added with `ip route add` are not persistent.

When the machine comes back online, Linux starts with a fresh routing table.

Our manually added routes disappear.

Cross-node networking breaks again until someone logs in and recreates them.

Clearly, this doesn't scale.

We need a way to keep every node's routing table synchronized automatically.

Fortunately, Kubernetes already gives us the perfect mechanism for running software on every node.

A **DaemonSet**.
## Keeping Routes Up to Date

We've now solved the networking problem.

Pods on different worker nodes can communicate with one another.

But we've introduced an operational problem.

Our solution depends entirely on manually adding routes to every node.

That might be acceptable for a two-node lab.

It quickly becomes impossible in a real Kubernetes cluster.

Imagine a cluster with ten worker nodes.

Every node needs routes to the Pod CIDRs of the other nine workers.

When a new worker joins, every existing node must learn about it.

When a worker leaves, every existing node must remove that route.

When a worker's IP address changes, every route pointing to it must be updated.

Doing this manually simply doesn't scale.

Instead, we should automate it.


## Why a DaemonSet?

Kubernetes already provides exactly what we need.

A **DaemonSet**.

Unlike a Deployment, which schedules a specific number of replicas somewhere in the cluster, a DaemonSet guarantees that one Pod runs on **every** node.

Conceptually:

```
                 Kubernetes Cluster
           +----------------------------+
             Control Plane
                  │
             Route Daemon
        Worker-1
             │
        Route Daemon
        Worker-2
             │
        Route Daemon
        Worker-3
             │
        Route Daemon
```

Every node now has a small helper responsible for maintaining its routing table.

This is exactly the kind of workload DaemonSets were designed for.

Other examples include:

- CNI plugins
- kube-proxy
- log collectors
- monitoring agents
- storage plugins

All of them need to run once per node.

Our routing daemon is no different.


## What Should the Daemon Actually Do?

The daemon has one responsibility.

Keep the Linux routing table synchronized with the current Kubernetes cluster.

One possible algorithm looks like this.

```
Loop forever
    │
Read all Nodes from the Kubernetes API
    │
For each Node
    │
Read:
- Internal IP
- Pod CIDR
    │
Compare with local routing table
    │
Missing route?
    │
Add it
    │
Removed node?
    │
Delete the route
    │
Sleep
Repeat
```

That's all.

Notice something interesting.

The daemon doesn't need to know anything about Pods.

It only cares about **Nodes**.

Every Node already advertises:

- its Internal IP
- its assigned Pod CIDR

Those two pieces of information are enough to build the routing table for the entire cluster.


## Why Not Build This Into the CNI?

At first, it might seem easier to update routes directly from our CNI plugin.

After all, the CNI already runs whenever a Pod is created.

But think about what happens if:

- a new node joins the cluster without any Pods scheduled yet
- a worker node is removed
- a worker node changes its IP address
- the machine reboots and loses all manually added routes

None of those events necessarily cause the CNI to execute.

Remember, the CNI only runs when the container runtime asks it to configure or remove networking for a Pod.

Managing cluster-wide routing is a different responsibility.

By separating the routing daemon from the CNI, each component has a single job.

Our CNI configures networking for an individual Pod.

Our DaemonSet keeps every node's routing table correct.

This separation makes the system much easier to reason about and maintain.


## Required Permissions

Unlike ordinary application Pods, our routing daemon needs permission to modify the host machine.

Specifically, it must:

- read Kubernetes Nodes
- modify the host's routing table
- execute networking commands
- access the host network namespace

That means our DaemonSet will need:

- `hostNetwork: true`
- privileged execution (or at least the `NET_ADMIN` capability)
- a ServiceAccount with permission to read Nodes

Without these permissions, the daemon would only modify its own container's network namespace—not the host's routing table.

We'll build the DaemonSet itself later in the series.

For now, it's enough to understand why those permissions are necessary.


## What We've Built

Let's pause and appreciate how far we've come.

At the beginning of this series, a freshly installed Kubernetes cluster couldn't even schedule a Pod.

The nodes were **NotReady** because there was no networking.

Now we've built our own networking solution from scratch.

Our implementation can now:

✅ Create a Linux bridge

✅ Allocate Pod IP addresses

✅ Create virtual Ethernet pairs

✅ Connect Pods to the bridge

✅ Configure routing inside Pods

✅ Enable Host → Pod communication

✅ Enable Pod → Host communication

✅ Enable Pod → Pod communication on the same node

✅ Enable Pod → Pod communication across different nodes

✅ Automatically distribute routes across the cluster using a DaemonSet

Although our implementation is intentionally simple, these are the same fundamental responsibilities performed by every Kubernetes networking solution.

Projects like Flannel, Calico and Cilium are significantly more sophisticated, but they all solve the same underlying problem:

> Given an isolated Linux network namespace, connect it to every other Pod in the cluster.

The difference lies in *how* they transport packets, distribute routes, enforce security policies and scale to thousands of nodes.


## What's Coming Next?

At this point, we've built the networking foundation of a real CNI.

Pods can now communicate freely across the cluster.

Ironically, that's now our next problem.

Should every Pod really be allowed to talk to every other Pod?

In most production environments, the answer is **no**.

A frontend application probably shouldn't connect directly to your database.

A monitoring agent shouldn't be able to access every workload.

Different namespaces often require completely different security boundaries.

That's where **Network Policies** come in.

In the next article, we'll extend our CNI by implementing support for Kubernetes NetworkPolicies.

We'll explore how policy engines translate Kubernetes objects into Linux networking rules using technologies like **iptables** and **nftables**, allowing us to control exactly which Pods are allowed to communicate with one another.

By the end of Part 5, our CNI won't just connect Pods—it will also decide **which connections are permitted**.
